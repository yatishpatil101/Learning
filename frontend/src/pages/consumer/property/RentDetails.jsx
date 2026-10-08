import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { fmtNum } from '../../../lib/format.js';
import { availableLabel, propertyKind } from './derivations.js';
import { useLocalityStats } from './useLocalityStats.js';
import { fixturesFor, commercialProfileFromType, withInFlatAsFurniture } from '../list-property/constants.js';

const RENT_INVENTORY = {
  furnished: ['wardrobes', 'beds', 'sofa', 'fridge', 'washingMachine', 'ac', 'modularKitchen', 'geyser'],
  semi: ['wardrobes', 'modularKitchen', 'geyser', 'fansLights'],
  unfurnished: ['fansLights'],
};

const toNum = (v) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;

export function RentDetails({ p }) {
  const { t: tr } = useTranslation();
  const isResidential = propertyKind(p) === 'residential';
  const isLand = propertyKind(p) === 'land';
  const isCommercial = propertyKind(p) === 'commercial';

  // "None" is a term the owner agreed to; silence is not.
  const monthsLabel = (m) => {
    if (m == null || m === '') return tr('property.notSpecified');
    const n = Number(m) || 0;
    return n <= 0 ? tr('property.monthsNone') : tr('property.months', { count: n });
  };

  const rent = toNum(p.price);
  const hasDeposit = p.deposit != null && p.deposit !== '' && toNum(p.deposit) > 0;
  const deposit = hasDeposit ? toNum(p.deposit) : null;
  /* Only charge extra when the owner said so. */
  const maintExtra = p.rentMaintMode === 'extra' ? toNum(p.rentMaintenance) : 0;
  const camPerSqft = toNum(p.camCharges);
  const maintLabel = isCommercial
    ? (camPerSqft ? '₹' + fmtNum(camPerSqft) + '/sq.ft.' : tr('property.askOwner'))
    : p.rentMaintMode === 'extra'
      ? (maintExtra ? '₹' + fmtNum(maintExtra) : tr('property.maintExtra'))
      : p.rentMaintMode === 'included' ? tr('property.maintIncluded') : tr('property.askOwner');
  const allIn = rent + maintExtra;
  const moveIn = deposit == null ? null : rent + deposit;
  const savings = rent;

  const available = availableLabel(tr, p.availableFrom, p.availableDate);
  const furnishing = tr('property.rentFurnishing.' + (['furnished', 'semi', 'unfurnished'].includes(p.furnishing) ? p.furnishing : 'semi'));
  /* Filtered to the profile's valid options so a stale cross-profile pick never shows. */
  const commercialFitOut = () => {
    const opts = fixturesFor(commercialProfileFromType(p.commercialType || p.type));
    const declared = [
      ...(Array.isArray(p.fixtures) ? p.fixtures : []),
      ...(Array.isArray(p.amenities) ? p.amenities : []),
    ].filter((f) => opts.includes(f));
    const signals = [];
    if (['bareShell', 'warmShell', 'furnished'].includes(p.shellType)) signals.push(tr('property.shell.' + p.shellType));
    const wr = parseInt(p.washrooms, 10) || 0;
    if (wr) signals.push(tr('property.washroom', { count: wr }));
    if (p.powerBackup) signals.push(tr('property.inventory.powerBackup'));
    if (p.pantry) signals.push(tr('property.pantry'));
    return [...new Set([...declared, ...signals])];
  };
  const ownInventory = withInFlatAsFurniture({ amenities: p.amenities || [], furniture: p.furniture || [] }).furniture;
  const inventory = isCommercial
    ? commercialFitOut()
    : Array.isArray(p.furniture) || ownInventory.length
      ? ownInventory
      : (RENT_INVENTORY[p.furnishing] || RENT_INVENTORY.semi).map((k) => tr('property.inventory.' + k));

  const tenantList = String(p.tenants || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((t) => { const key = t === 'any' ? 'anyone' : t; return ['family', 'bachelors', 'bachelor-male', 'bachelor-female', 'company', 'anyone'].includes(key) ? tr('property.tenant.' + key) : t; });
  const businessList = Array.isArray(p.suitableFor) ? p.suitableFor : [];
  const gstLabel = p.gstOnRent === 'yes' ? tr('property.gstApplicable')
    : p.gstOnRent === 'no' ? tr('property.gstNotApplicable') : tr('property.askOwner');
  const petsLabel = p.pets === true ? tr('property.petsAllowed') : p.pets === false ? tr('property.petsNotAllowed') : tr('property.askOwner');
  const foodLabel = p.food === 'veg' ? tr('property.foodVeg') : p.food === 'jain' ? tr('property.foodJain') : p.food === 'any' ? tr('property.foodBoth') : tr('property.askOwner');
  const depMonths = rent ? Math.round(deposit / rent) : 0;
  const depMonthsLabel = depMonths ? tr('property.depMonths', { count: depMonths }) : '—';
  const agreementDuration = p.agreementDuration == null || p.agreementDuration === ''
    ? tr('property.notSpecified')
    : p.agreementDuration === 'long' ? tr('property.longTerm') : monthsLabel(p.agreementDuration);

  // Residential listings only: the locality figure is the average rent of its live listings (null below 3),
  // shown as context, not a verdict, because homes of different sizes are mixed in it.
  const loc = useLocalityStats(p);
  const avgRent = isResidential ? loc?.avgRent : null;

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

        <div className="glass rounded-2xl p-6 lg:col-span-2">
          <div className="flex items-center gap-2 mb-1"><Icon name="wallet" className="w-4 h-4 text-brand-teal-2" /><h3 className="font-semibold text-white">{tr('property.whatYoullPay')}</h3></div>
          <p className="rd-sub">{tr('property.whatYoullPaySub')}</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {tile('indian-rupee', tr('property.monthlyRent'), '₹' + fmtNum(rent))}
            {tile('receipt-indian-rupee', tr('property.maintenance'), maintLabel, 'rent.maintenance')}
            {tile('landmark', tr('property.deposit'), deposit == null ? tr('property.askOwner') : '₹' + fmtNum(deposit), 'rent.deposit')}
          </div>

          <div className="mt-3 rounded-xl border border-emerald-500/25 p-4 flex flex-wrap items-center justify-between gap-4" style={{ background: 'rgb(var(--dz-c-emerald-500) / .07)' }}>
            <div>
              <p className="text-xs text-slate-400">{tr('property.allInMonthly')}</p>
              <p className="text-2xl font-extrabold text-white leading-tight">₹{fmtNum(allIn)}</p>
              <p className="text-[11px] text-emerald-300 flex items-center gap-1 mt-0.5"><Icon name="hand-coins" className="w-3 h-3" /> {maintExtra ? tr('property.inclMaintenance') : ''}{tr('property.brokerageSave', { amount: fmtNum(savings) })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">{tr('property.oneTimeMoveIn')}</p>
              <p className="text-xl font-extrabold text-brand-teal-3">{moveIn == null ? tr('property.askOwner') : '₹' + fmtNum(moveIn)}</p>
              <p className="text-[11px] text-slate-500">{tr('property.firstMonthDeposit')}</p>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-white/5">
            <p className="text-xs text-slate-400 mb-2.5 flex items-center gap-1.5"><Icon name="file-signature" className="w-4 h-4 text-brand-teal-3" /> {tr('property.tenancyTerms')}</p>
            <div className={`grid grid-cols-2 ${isLand ? 'sm:grid-cols-3' : 'sm:grid-cols-5'} gap-2.5`}>
              {tile('calendar-check', tr('property.available'), available)}
              {tile('file-text', tr('property.agreementDuration'), agreementDuration)}
              {tile('lock', tr('property.lockIn'), monthsLabel(p.lockin), 'rent.lockin')}
              {tile('clock', tr('property.notice'), monthsLabel(p.notice), 'rent.notice')}
              {!isLand ? tile('sofa', tr('property.furnishingLabel'), furnishing) : null}
            </div>
            {isCommercial ? (
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {tile('receipt-indian-rupee', tr('property.gstOnRent'), gstLabel)}
                {tile('calendar-clock', tr('property.fitOutPeriod'), monthsLabel(p.fitOutMonths))}
                {tile('trending-up', tr('property.escalation'), p.escalationPct ? p.escalationPct + '%' : tr('property.notSpecified'))}
              </div>
            ) : null}
          </div>

          {!isLand && inventory.length ? (
          <div className="mt-5 pt-5 border-t border-white/5">
            <p className="text-xs text-slate-400 mb-2.5 flex items-center gap-1.5"><Icon name={isCommercial ? 'building-2' : 'sofa'} className="w-4 h-4 text-brand-teal-3" /> {isCommercial ? tr('property.fitOutFixtures') : tr('property.whatsIncluded')}</p>
            <div className="flex flex-wrap gap-2">{inventory.map((it) => <span key={it} className="tag tag-teal">{it}</span>)}</div>
          </div>
          ) : null}

          {avgRent ? (
            <div className="mt-5 pt-5 border-t border-white/5">
              <div className="rd-cell" data-testid="rent-locality-avg">
                <p className="rd-lbl">{tr('property.localityAvgRent', { locality: p.locality })}</p>
                <p className="rd-val-lg">₹{fmtNum(avgRent)}<span className="text-sm font-medium text-slate-400">{tr('property.perMonth')}</span></p>
              </div>
            </div>
          ) : null}
        </div>

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
              {tile('users', tr('property.suitableFor'), businessList.length ? businessList.join(', ') : tr('property.anyBusiness'))}
            </div>
          )}

          <div className="rounded-xl border border-emerald-500/20 px-3.5 py-3 mb-4 flex items-center gap-2" style={{ background: 'rgb(var(--dz-c-emerald-500) / .06)' }}>
            <Icon name="hand-coins" className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <p className="text-xs text-slate-300">{tr('property.zeroBrokerageOwner')}</p>
          </div>

          <div className="rounded-xl border border-white/10 p-4 mb-4">
            <p className="rd-lbl mb-3 flex items-center gap-1.5"><Icon name="wallet" className="w-4 h-4 text-brand-teal-3" /> {tr('property.moveInSnapshot')}</p>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">{tr('property.oneTimeMoveIn')}</dt>
                <dd className="font-semibold text-brand-teal-3">{moveIn == null ? tr('property.askOwner') : '₹' + fmtNum(moveIn)}</dd>
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
          </div>
        </div>
      </div>
    </section>
  );
}

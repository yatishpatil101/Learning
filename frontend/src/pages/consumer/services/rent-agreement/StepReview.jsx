import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import ReviewRow from './ReviewRow.jsx';
import { fmt, digits, num } from './helpers.js';

export default function StepReview({ step, aType, prop, owner, tenantMode, invite, tenants, terms, cost, maint, furnitureText, regArea, declare, setDeclare, generate }) {
  const { t: tr } = useTranslation();
  const typeLabel = { Residential: tr('services.ra.property.typeResidential'), Commercial: tr('services.ra.property.typeCommercial') };
  const maintLabel = { Tenant: tr('services.ra.terms.maintOpt.Tenant'), Owner: tr('services.ra.terms.maintOpt.Owner') };
  return (
    <div className={'step-panel' + (step === 5 ? ' active' : '')}>
      <h2 className="text-xl font-bold text-white mb-1">{tr('services.ra.review.title')}</h2>
      <p className="text-gray-500 text-sm mb-6">{tr('services.ra.review.subtitle')}</p>
      <div className="space-y-3">
        <ReviewRow k={tr('services.ra.review.rowAgreement')} v={(typeLabel[aType] || aType) + ' · ' + prop.propType} />
        <ReviewRow k={tr('services.ra.review.rowProperty')} v={[prop.flatNo, prop.society, prop.locality, prop.city].filter(Boolean).join(', ')} />
        <ReviewRow k={tr('services.ra.review.rowOwner')} v={owner.oName} />
        <ReviewRow k={tr('services.ra.review.rowTenants')} v={tenantMode === 'invite' ? tr('services.ra.review.invitedPending', { name: invite.invName || '••••••' + digits(invite.invMobile).slice(-4) }) : tenants.map((t) => t.name.trim()).filter(Boolean).join(', ')} />
        <ReviewRow k={tr('services.ra.review.rowTerm')} v={tr('services.ra.review.termValue', { count: num(terms.months), date: terms.startDate || '—' })} />
        <ReviewRow k={tr('services.ra.review.rowMonthlyRent')} v={fmt(cost.rent)} />
        <ReviewRow k={tr('services.ra.review.rowDeposit')} v={fmt(num(terms.deposit))} />
        <ReviewRow k={tr('services.ra.review.rowMaintenance')} v={maintLabel[maint] || maint} />
        <ReviewRow k={tr('services.ra.review.rowFurniture')} v={furnitureText()} />
        <ReviewRow k={tr('services.ra.review.rowRegistration')} v={regArea === 'rural' ? tr('services.ra.terms.regRural') : tr('services.ra.terms.regUrban')} />
      </div>
      <label className="flex items-start gap-2.5 mt-5 cursor-pointer">
        <input type="checkbox" checked={declare} onChange={(e) => setDeclare(e.target.checked)} className="accent-teal-500 w-4 h-4 mt-0.5" />
        <span className="text-xs text-gray-400">{tr('services.ra.review.declaration')}</span>
      </label>
      <button type="button" onClick={generate} className="btn-teal w-full mt-5 py-3.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="file-check-2" className="w-4 h-4" /> {tr('services.ra.review.generate')}</button>
    </div>
  );
}

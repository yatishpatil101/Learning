import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { fmt } from './helpers.js';

function CostLines({ cost }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2.5 text-sm">
      <div className="flex justify-between"><span className="text-gray-400">{t('services.ra.cost.monthlyRent')}</span><span className="text-white font-medium">{fmt(cost.rent)}</span></div>
      <div className="flex justify-between"><span className="text-gray-400">{t('services.ra.cost.depositRefundable')}</span><span className="text-white font-medium">{fmt(cost.dep)}</span></div>
      <div className="flex justify-between"><span className="text-gray-400">{t('services.ra.cost.term')}</span><span className="text-white font-medium">{t('services.ra.cost.termMonths', { count: cost.months })}</span></div>
      <div className="h-px bg-white/8 my-1" />
      <div className="flex justify-between"><span className="text-gray-400">{t('services.ra.cost.stampDuty')}</span><span className="text-white font-medium">{fmt(cost.stamp)}</span></div>
      <div className="flex justify-between"><span className="text-gray-400">{t('services.ra.cost.registrationFee')}</span><span className="text-white font-medium">{fmt(cost.reg)}</span></div>
      <div className="flex justify-between"><span className="text-gray-400">{t('services.ra.cost.serviceFee')}</span><span className="text-white font-medium">{fmt(cost.service)}</span></div>
      <div className="h-px bg-white/8 my-1" />
      <div className="flex justify-between items-center"><span className="text-white font-semibold">{t('services.ra.cost.estimatedTotal')}</span><span className="text-lg font-bold gradient-text">{fmt(cost.total)}</span></div>
    </div>
  );
}

// Mobile-only collapsible cost summary so the estimate is reachable while filling the form.
export function MobileCostSummary({ cost }) {
  const { t } = useTranslation();
  return (
    <details className="ra-mcost lg:hidden glass-card rounded-2xl p-4 mb-6 group">
      <summary className="flex items-center justify-between cursor-pointer select-none">
        <span className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="receipt" className="w-4 h-4 text-teal-400" /> {t('services.ra.cost.estimatedTotal')}</span>
        <span className="flex items-center gap-2"><span className="text-lg font-bold gradient-text">{fmt(cost.total)}</span><Icon name="chevron-down" className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" /></span>
      </summary>
      <div className="mt-4 pt-4 border-t border-white/8">
        <p className="text-gray-500 text-xs mb-3">{t('services.ra.cost.subtitle')}</p>
        <CostLines cost={cost} />
      </div>
    </details>
  );
}

export default function CostSidebar({ cost }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-white font-bold mb-1">{t('services.ra.cost.title')}</h3>
        <p className="text-gray-500 text-xs mb-4">{t('services.ra.cost.subtitle')}</p>
        <CostLines cost={cost} />
        <p className="text-gray-600 text-[11px] mt-4 leading-relaxed">{t('services.ra.cost.formula')}</p>
      </div>
      <div className="glass-card rounded-2xl p-5">
        <p className="text-white font-semibold text-sm mb-1">{t('services.ra.cost.needHelp')}</p>
        <p className="text-gray-500 text-xs mb-3">{t('services.ra.cost.needHelpSub')}</p>
        <a href="tel:18002000000" className="text-teal-400 text-sm font-semibold flex items-center gap-2"><Icon name="headset" className="w-4 h-4" /> 1800 200 0000</a>
      </div>
    </div>
  );
}

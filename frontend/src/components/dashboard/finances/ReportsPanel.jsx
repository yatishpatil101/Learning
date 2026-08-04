import { useTranslation } from 'react-i18next';
import Icon from '../../Icon.jsx';
import { fmtINR } from '../../../lib/format.js';
import { Card, SectionHead } from './helpers.jsx';

const BASIS_KEYS = { owned: 'fin.basisOwned', financed: 'fin.basisFinanced', inherited: 'fin.basisInherited' };

export default function ReportsPanel({ basis, summary, onEditBasis }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <Card className="p-5 sm:p-6">
          <SectionHead icon="trending-up" iconCls="text-emerald-400" title={t('fin.capitalAppreciation')} sub={t('fin.capitalAppreciationSub')} />
          {basis && basis.purchasePrice ? (
            <div className="space-y-3 mt-2">
              <div className="flex justify-between text-sm"><span className="text-gray-400">{t('fin.purchasePrice')}</span><span className="text-white font-semibold">{fmtINR(basis.purchasePrice)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">{t('fin.currentValueEst')}</span><span className="text-emerald-400 font-semibold">{fmtINR(basis.currentValue || Math.round(basis.purchasePrice * 1.12))}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">{t('fin.kpiAppreciation')}</span><span className="text-emerald-300 font-semibold">+{basis.currentValue ? Math.round((basis.currentValue / basis.purchasePrice - 1) * 100) : 12}%</span></div>
            </div>
          ) : (
            <button onClick={onEditBasis} className="text-sm text-teal-400 hover:text-teal-300 mt-2">{t('fin.addBasisCta')}</button>
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <SectionHead icon="calculator" iconCls="text-teal-400" title={t('fin.taxReady')} sub={t('fin.taxReadySub')} />
          <div className="space-y-3 mt-2">
            <div className="flex justify-between text-sm"><span className="text-gray-400">{t('fin.grossRental')}</span><span className="text-white font-semibold">{fmtINR(summary.income)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-400">{t('fin.stdDeduction')}</span><span className="text-amber-300 font-semibold">-{fmtINR(Math.round(summary.income * 0.3))}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-400">{t('fin.netTaxable')}</span><span className="text-white font-semibold">{fmtINR(Math.round(summary.income * 0.7))}</span></div>
            <p className="text-[11px] text-gray-500 mt-1">{t('fin.taxNote')}</p>
          </div>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <SectionHead icon="home" title={t('fin.ownershipBasis')} sub={t('fin.ownershipBasisSub')} action={<button onClick={onEditBasis} className="pn-control pn-control--ghost px-3 gap-1.5"><Icon name="pencil" className="w-4 h-4" /> {t('fin.edit')}</button>} />
        {basis?.purchasePrice ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['fin.type', basis.type ? t(BASIS_KEYS[basis.type] || basis.type, { defaultValue: basis.type }) : '—'],
              ['fin.purchasePrice', fmtINR(basis.purchasePrice)],
              ['fin.purchaseDate', basis.purchaseDate || '—'],
              ['fin.currentValue', basis.currentValue ? fmtINR(basis.currentValue) : '—'],
            ].map(([k, v]) => (
              <div key={k} className="p-3 rounded-lg bg-white/[0.03]">
                <p className="text-[11px] text-gray-400">{t(k)}</p>
                <p className="text-sm text-white font-semibold mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">{t('fin.noBasis')}</p>
        )}
      </Card>
    </div>
  );
}

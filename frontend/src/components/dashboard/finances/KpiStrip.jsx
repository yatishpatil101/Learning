import { useTranslation } from 'react-i18next';
import Icon from '../../Icon.jsx';
import HScroll from '../../ui/HScroll.jsx';
import { fmtINR } from '../../../lib/format.js';
import Stat from './Stat.jsx';

// KPI — swipeable carousel on mobile, 4-up grid on desktop (same tiles).
// Each tile is a render fn so the mobile carousel and desktop grid each build
// their own fresh elements (no sharing one element object across two subtrees).
export default function KpiStrip({ summary, kpiTrend, cf, netSeries, basis, onEditBasis }) {
  const { t } = useTranslation();
  const kpiTiles = [
    { key: 'collected', render: () => <Stat icon="trending-up" bg="bg-emerald-400/15" fg="text-emerald-400" value={fmtINR(summary.income)} label={t('fin.kpiCollected')} trend={kpiTrend.income} spark={{ data: cf.incomeData, color: '#34d399' }} className="p-4" /> },
    { key: 'expenses', render: () => <Stat icon="trending-down" bg="bg-rose-400/15" fg="text-rose-400" value={fmtINR(summary.expense)} label={t('fin.kpiExpenses')} spark={{ data: cf.expenseData, color: '#fb7185' }} className="p-4" /> },
    { key: 'net', render: () => <Stat icon="wallet" bg="bg-teal-400/15" fg="text-teal-400" value={fmtINR(summary.net)} label={t('fin.kpiNet')} trend={kpiTrend.net} spark={{ data: netSeries, color: '#2dd4bf' }} className="p-4" /> },
    {
      key: 'roi',
      render: () => (basis?.purchasePrice && basis?.currentValue) ? (
        <Stat icon="chart-line" bg="bg-teal-400/15" fg="text-teal-400" value={((basis.currentValue - basis.purchasePrice) / basis.purchasePrice * 100).toFixed(1) + '%'} label={t('fin.kpiAppreciation')} className="p-4" />
      ) : (
        <button type="button" onClick={onEditBasis} className="glass-card rounded-2xl p-4 w-full h-full text-left transition hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-teal-400/15">
            <Icon name="chart-line" className="w-5 h-5 text-teal-400" />
          </div>
          <p className="text-sm font-semibold text-teal-300">{t('fin.setUpRoi')}</p>
          <p className="text-gray-400 text-xs mt-0.5">{t('fin.setUpRoiSub')}</p>
        </button>
      ),
    },
  ];

  return (
    <>
      <HScroll wrapClassName="-mx-4 lg:hidden" fadeColor="var(--brand-dark, #0f0d1a)" className="flex gap-3 px-4">
        {kpiTiles.map((k) => <div key={k.key} className="shrink-0 w-[9.5rem]">{k.render()}</div>)}
      </HScroll>
      <div className="hidden lg:grid lg:grid-cols-4 gap-4">
        {kpiTiles.map((k) => <div key={k.key} className="flex">{k.render()}</div>)}
      </div>
    </>
  );
}

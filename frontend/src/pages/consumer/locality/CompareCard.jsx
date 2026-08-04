import { useTranslation } from 'react-i18next';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import { BarChart } from '../../../components/charts/index.jsx';
import { NAMES } from './helpers.js';

export default function CompareCard({ cmpMetric, setCmpMetric, cmp, toggleCmp, cmpData, cmpOpts }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 reveal">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-white">{t('locality.compareTitle')}</h2>
        <div className="w-[30%] min-w-[140px] max-w-[190px]">
          <NativeSelect value={cmpMetric} onChange={(e) => setCmpMetric(e.target.value)} className="field text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-gray-200"><option value="price">{t('locality.metricPrice')}</option><option value="rent">{t('locality.metricRent')}</option><option value="yield">{t('locality.metricYield')}</option><option value="yoy">{t('locality.metricYoy')}</option><option value="liv">{t('locality.metricLiv')}</option></NativeSelect>
        </div>
      </div>
      <p className="text-gray-500 text-xs mb-3">{t('locality.compareHint')}</p>
      <div className="flex flex-wrap gap-2 mb-5">{NAMES.map((n) => <button key={n} onClick={() => toggleCmp(n)} className={'chip text-xs font-medium px-3 py-1.5 rounded-full text-gray-300 ' + (cmp.has(n) ? 'on' : '')}>{cmp.has(n) ? '✓ ' : ''}{n}</button>)}</div>
      <BarChart labels={cmpData.labels} datasets={cmpData.datasets} height={240} options={cmpOpts} />
    </div>
  );
}

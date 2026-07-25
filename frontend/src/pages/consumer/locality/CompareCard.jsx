import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import { BarChart } from '../../../components/charts/index.jsx';
import { NAMES } from './helpers.js';

export default function CompareCard({ cmpMetric, setCmpMetric, cmp, toggleCmp, cmpData, cmpOpts }) {
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 reveal">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-white">Compare Localities</h2>
        <div className="w-[30%] min-w-[140px] max-w-[190px]">
          <NativeSelect value={cmpMetric} onChange={(e) => setCmpMetric(e.target.value)} className="field text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-gray-200"><option value="price">Price / sq.ft.</option><option value="rent">2 BHK Rent</option><option value="yield">Rental Yield</option><option value="yoy">YoY Appreciation</option><option value="liv">Livability Score</option></NativeSelect>
        </div>
      </div>
      <p className="text-gray-500 text-xs mb-3">Tap localities to add or remove them from the comparison.</p>
      <div className="flex flex-wrap gap-2 mb-5">{NAMES.map((n) => <button key={n} onClick={() => toggleCmp(n)} className={'chip text-xs font-medium px-3 py-1.5 rounded-full text-gray-300 ' + (cmp.has(n) ? 'on' : '')}>{cmp.has(n) ? '✓ ' : ''}{n}</button>)}</div>
      <BarChart labels={cmpData.labels} datasets={cmpData.datasets} height={240} options={cmpOpts} />
    </div>
  );
}

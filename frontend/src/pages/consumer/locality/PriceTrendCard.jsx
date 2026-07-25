import { Line } from 'react-chartjs-2';

const trendOpts = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.parsed.y == null ? null : `${c.dataset.label}: ₹${c.parsed.y.toLocaleString('en-IN')}`) } } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 11 }, maxRotation: 0, autoSkip: true } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 11 }, callback: (v) => '₹' + (v / 1000).toFixed(0) + 'k' } } } };

export default function PriceTrendCard({ current, range, setRange, data }) {
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 reveal">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div><h2 className="text-lg font-bold text-white">Price Trend <span className="text-gray-500 text-sm font-normal">(₹/sq.ft.)</span></h2><p className="text-gray-500 text-xs mt-0.5">Historic + 2-year forecast vs Pune average</p></div>
        <div className="flex gap-1.5">{['1Y', '3Y', '5Y'].map((r) => <button key={r} onClick={() => setRange(r)} className={'seg text-xs font-semibold px-3 py-1.5 rounded-lg text-gray-300' + (range === r ? ' active' : '')}>{r}</button>)}</div>
      </div>
      <div style={{ height: '300px' }}><Line data={data} options={trendOpts} /></div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-xs">
        <span className="flex items-center gap-2 text-gray-400"><span className="w-3 h-0.5 rounded bg-[#14b8a6]" /> {current}</span>
        <span className="flex items-center gap-2 text-gray-400"><span className="w-3 h-0.5 rounded bg-[#6366f1]" /> Pune average</span>
        <span className="flex items-center gap-2 text-gray-400"><span className="w-3 border-t border-dashed border-amber-400" /> Forecast</span>
      </div>
    </div>
  );
}

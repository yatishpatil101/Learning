import { dColor } from './helpers.js';

export default function LeaderboardCard({ rows, current, onSort, onLoad }) {
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 reveal">
      <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold text-white">Pune Locality Leaderboard</h2><span className="text-gray-500 text-xs hidden sm:block">Click a column to sort · click a row to load</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-gray-500 text-xs border-b border-white/10">
              <th className="text-left font-medium py-3 pr-3">#</th>
              <th className="text-left font-medium py-3 pr-3 sortable" onClick={() => onSort('name')}>Locality</th>
              <th className="text-right font-medium py-3 px-3 sortable" onClick={() => onSort('price')}>₹/sq.ft.</th>
              <th className="text-right font-medium py-3 px-3 sortable" onClick={() => onSort('yoy')}>YoY</th>
              <th className="text-right font-medium py-3 px-3 sortable" onClick={() => onSort('yield')}>Yield</th>
              <th className="text-right font-medium py-3 px-3 sortable" onClick={() => onSort('liv')}>Livability</th>
              <th className="text-right font-medium py-3 pl-3 sortable" onClick={() => onSort('demand')}>Demand</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} onClick={() => onLoad(r.name)} className={'lb-row border-b border-white/5' + (r.name === current ? ' active' : '')}>
                <td className="py-3 pr-3 text-gray-500">{i + 1}</td>
                <td className="py-3 pr-3 font-semibold text-white">{r.name}</td>
                <td className="py-3 px-3 text-right text-gray-200">₹{r.price.toLocaleString('en-IN')}</td>
                <td className="py-3 px-3 text-right text-emerald-400">+{r.yoy}%</td>
                <td className="py-3 px-3 text-right text-gray-200">{r.yield}%</td>
                <td className="py-3 px-3 text-right text-gray-200">{r.liv}</td>
                <td className="py-3 pl-3 text-right"><span className={'text-[11px] font-semibold px-2 py-0.5 rounded-full ' + dColor(r.demandTxt)}>{r.demandTxt}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

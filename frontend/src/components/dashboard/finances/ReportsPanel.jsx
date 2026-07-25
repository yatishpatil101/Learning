import Icon from '../../Icon.jsx';
import { fmtINR } from '../../../lib/format.js';
import { Card, SectionHead } from './helpers.jsx';

export default function ReportsPanel({ basis, summary, onEditBasis }) {
  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <Card className="p-5 sm:p-6">
          <SectionHead icon="trending-up" iconCls="text-emerald-400" title="Capital appreciation" sub="Estimated value growth over time." />
          {basis && basis.purchasePrice ? (
            <div className="space-y-3 mt-2">
              <div className="flex justify-between text-sm"><span className="text-gray-400">Purchase price</span><span className="text-white font-semibold">{fmtINR(basis.purchasePrice)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Current value (est.)</span><span className="text-emerald-400 font-semibold">{fmtINR(basis.currentValue || Math.round(basis.purchasePrice * 1.12))}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Appreciation</span><span className="text-emerald-300 font-semibold">+{basis.currentValue ? Math.round((basis.currentValue / basis.purchasePrice - 1) * 100) : 12}%</span></div>
            </div>
          ) : (
            <button onClick={onEditBasis} className="text-sm text-teal-400 hover:text-teal-300 mt-2">Add ownership basis to see appreciation →</button>
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <SectionHead icon="calculator" iconCls="text-teal-400" title="Tax-ready summary (Section 24)" sub="Annual rental income & deduction summary." />
          <div className="space-y-3 mt-2">
            <div className="flex justify-between text-sm"><span className="text-gray-400">Gross rental income</span><span className="text-white font-semibold">{fmtINR(summary.income)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-400">Standard deduction (30%)</span><span className="text-amber-300 font-semibold">-{fmtINR(Math.round(summary.income * 0.3))}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-400">Net taxable rental</span><span className="text-white font-semibold">{fmtINR(Math.round(summary.income * 0.7))}</span></div>
            <p className="text-[11px] text-gray-500 mt-1">* For properties held as house property. Consult a CA for complete tax filing.</p>
          </div>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <SectionHead icon="home" title="Ownership basis" sub="Purchase info for ROI calculations" action={<button onClick={onEditBasis} className="pn-control pn-control--ghost px-3 gap-1.5"><Icon name="pencil" className="w-4 h-4" /> Edit</button>} />
        {basis?.purchasePrice ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Type', basis.type ? basis.type.charAt(0).toUpperCase() + basis.type.slice(1) : '—'],
              ['Purchase price', fmtINR(basis.purchasePrice)],
              ['Purchase date', basis.purchaseDate || '—'],
              ['Current value', basis.currentValue ? fmtINR(basis.currentValue) : '—'],
            ].map(([k, v]) => (
              <div key={k} className="p-3 rounded-lg bg-white/[0.03]">
                <p className="text-[11px] text-gray-400">{k}</p>
                <p className="text-sm text-white font-semibold mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No ownership info yet. Add purchase price to unlock ROI, appreciation and tax views.</p>
        )}
      </Card>
    </div>
  );
}

import Icon from '../../Icon.jsx';
import Select from '../../ui/Select.jsx';
import { fmtINR } from '../../../lib/format.js';
import { Card } from './helpers.jsx';

export default function ActivityPanel({ finType, setFinType, typeOpts, filteredTxs, showAllTx, setShowAllTx, onAdd, onRemove }) {
  const txRow = (t) => (
    <div key={t.id} className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + (t.type === 'income' ? 'bg-emerald-400/15 text-emerald-400' : 'bg-rose-400/15 text-rose-400')}>
          <Icon name={t.type === 'income' ? 'arrow-down-left' : 'arrow-up-right'} className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm truncate">{t.category}{t.note ? ` — ${t.note}` : ''}</p>
          <p className="text-gray-400 text-xs">{t.date}{t.repeat && t.repeat !== 'none' ? ' · recurring' : ''}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className={'text-sm font-semibold ' + (t.type === 'income' ? 'text-emerald-400' : 'text-rose-400')}>{t.type === 'income' ? '+' : '−'}{fmtINR(t.amount)}</span>
        <button onClick={() => onRemove(t.id)} aria-label="Remove transaction" className="text-gray-500 hover:text-rose-400 p-1"><Icon name="trash-2" className="w-4 h-4" /></button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="w-32 sm:w-36"><Select value={finType} onChange={setFinType} options={typeOpts} className="w-full" /></div>
        <button onClick={onAdd} className="pn-control pn-control--action px-4 gap-2"><Icon name="plus" className="w-4 h-4" /> Add</button>
      </div>
      <Card className="p-4 sm:p-5">
        {filteredTxs.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-3"><Icon name="receipt-indian-rupee" className="w-6 h-6 text-gray-500" /></div>
            <p className="text-gray-200 text-sm font-medium">No transactions yet</p>
            <p className="text-gray-400 text-xs mt-1">Add rent received or an expense to start your ledger.</p>
            <button onClick={onAdd} className="pn-control pn-control--action px-4 gap-2 mt-4 inline-flex"><Icon name="plus" className="w-4 h-4" /> Add transaction</button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-white/5">
              {filteredTxs.slice(0, showAllTx ? filteredTxs.length : 5).map(txRow)}
            </div>
            {filteredTxs.length > 5 && (
              <button onClick={() => setShowAllTx((v) => !v)} className="mt-3 w-full text-center text-xs text-teal-400 hover:text-teal-300 py-2">
                {showAllTx ? 'Show less' : `View all ${filteredTxs.length} →`}
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

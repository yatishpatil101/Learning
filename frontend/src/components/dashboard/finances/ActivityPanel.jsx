import { useTranslation } from 'react-i18next';
import Icon from '../../Icon.jsx';
import Select from '../../ui/Select.jsx';
import { fmtINR } from '../../../lib/format.js';
import { CAT_KEYS } from '../../../lib/data/finances.js';
import { Card } from './helpers.jsx';

export default function ActivityPanel({ finType, setFinType, typeOpts, filteredTxs, showAllTx, setShowAllTx, onAdd, onRemove }) {
  const { t } = useTranslation();
  const txRow = (tx) => (
    <div key={tx.id} className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + (tx.type === 'income' ? 'bg-emerald-400/15 text-emerald-400' : 'bg-rose-400/15 text-rose-400')}>
          <Icon name={tx.type === 'income' ? 'arrow-down-left' : 'arrow-up-right'} className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm truncate">{t(CAT_KEYS[tx.category] || tx.category, { defaultValue: tx.category })}{tx.note ? ` — ${tx.note}` : ''}</p>
          {/* `recurring`, the name `rentMapper.js:256,295` emits. `tx.repeat` was never on the view
              model, so the tag could not render and a standing EMI was indistinguishable from a
              one-off repair in the owner's own activity feed. `'none'` is kept in the guard: the
              mapper's fallback is `''`, but the wire vocabulary spells "not recurring" that way. */}
          <p className="text-gray-400 text-xs">{tx.date}{tx.recurring && tx.recurring !== 'none' ? ` · ${t('fin.recurringTag')}` : ''}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className={'text-sm font-semibold ' + (tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400')}>{tx.type === 'income' ? '+' : '−'}{fmtINR(tx.amount)}</span>
        <button onClick={() => onRemove(tx.id)} aria-label={t('fin.removeTx')} className="text-gray-500 hover:text-rose-400 p-1"><Icon name="trash-2" className="w-4 h-4" /></button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="w-32 sm:w-36"><Select value={finType} onChange={setFinType} options={typeOpts} className="w-full" /></div>
        <button onClick={onAdd} className="pn-control pn-control--action px-4 gap-2"><Icon name="plus" className="w-4 h-4" /> {t('fin.add')}</button>
      </div>
      <Card className="p-4 sm:p-5">
        {filteredTxs.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-3"><Icon name="receipt-indian-rupee" className="w-6 h-6 text-gray-500" /></div>
            <p className="text-gray-200 text-sm font-medium">{t('fin.noTx')}</p>
            <p className="text-gray-400 text-xs mt-1">{t('fin.noTxSub')}</p>
            <button onClick={onAdd} className="pn-control pn-control--action px-4 gap-2 mt-4 inline-flex"><Icon name="plus" className="w-4 h-4" /> {t('fin.addTransaction')}</button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-white/5">
              {filteredTxs.slice(0, showAllTx ? filteredTxs.length : 5).map(txRow)}
            </div>
            {filteredTxs.length > 5 && (
              <button onClick={() => setShowAllTx((v) => !v)} className="mt-3 w-full text-center text-xs text-teal-400 hover:text-teal-300 py-2">
                {showAllTx ? t('fin.showLess') : t('fin.viewAll', { count: filteredTxs.length })}
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

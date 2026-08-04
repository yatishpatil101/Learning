import { useTranslation } from 'react-i18next';
import Select from '../../ui/Select.jsx';
import DateField from '../../ui/DateField.jsx';
import Modal from '../../ui/Modal.jsx';
import { onlyDigits, grpINR } from './helpers.jsx';

// Add transaction — modal on every viewport (bottom-sheet feel on mobile)
export default function AddTransactionModal({ open, onClose, txForm, setTxForm, catOpts, onSubmit }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('fin.addTransaction')}
      footer={<>
        <button onClick={onClose} className="pn-control pn-control--ghost px-4">{t('fin.cancel')}</button>
        <button onClick={onSubmit} className="pn-control pn-control--action px-4">{t('fin.save')}</button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('fin.type')}</span>
            <Select value={txForm.type} onChange={(v) => setTxForm({ ...txForm, type: v, category: '' })} options={[{ value: 'income', label: t('fin.typeIncome') }, { value: 'expense', label: t('fin.typeExpense') }]} className="w-full" />
          </label>
          <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('fin.category')}</span>
            <Select value={txForm.category} onChange={(v) => setTxForm({ ...txForm, category: v })} options={catOpts} placeholder={t('fin.category')} className="w-full" />
          </label>
          <label className="text-sm" htmlFor="tx-amount"><span className="mb-1.5 block text-gray-400">{t('fin.amount')}</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">₹</span>
              <input id="tx-amount" inputMode="numeric" placeholder="0" value={grpINR(txForm.amount)} onChange={(e) => setTxForm({ ...txForm, amount: onlyDigits(e.target.value) })} className="field w-full pl-7 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" />
            </div>
          </label>
          <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('fin.date')}</span>
            <DateField value={txForm.date} onChange={(v) => setTxForm({ ...txForm, date: v })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" ariaLabel={t('fin.txDate')} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={txForm.recurring} onChange={(e) => setTxForm({ ...txForm, recurring: e.target.checked })} className="accent-teal-400" /> {t('fin.recurringMonthly')}</label>
        <label className="text-sm block"><span className="mb-1.5 block text-gray-400">{t('fin.notesOptional')}</span>
          <input value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder={t('fin.notesPh')} />
        </label>
      </div>
    </Modal>
  );
}

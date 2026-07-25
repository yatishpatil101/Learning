import Icon from '../../Icon.jsx';
import Select from '../../ui/Select.jsx';
import DateField from '../../ui/DateField.jsx';
import Modal from '../../ui/Modal.jsx';
import { onlyDigits, grpINR } from './helpers.jsx';

// Ownership basis — edit in a modal (opened by ROI CTA or Reports tab)
export default function BasisModal({ open, onClose, basisForm, setBasisForm, onSave }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ownership basis"
      footer={<>
        <button onClick={onClose} className="pn-control pn-control--ghost px-4">Cancel</button>
        <button onClick={() => { onSave(); onClose(); }} className="pn-control pn-control--action px-4 gap-1.5"><Icon name="save" className="w-4 h-4" /> Save</button>
      </>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm"><span className="mb-1.5 block text-gray-400">Type</span>
          <Select value={basisForm.type} onChange={(v) => setBasisForm({ ...basisForm, type: v })} options={[{ value: 'owned', label: 'Owned' }, { value: 'financed', label: 'Financed' }, { value: 'inherited', label: 'Inherited' }]} className="w-full" />
        </label>
        <label className="text-sm" htmlFor="fin-purchase-price"><span className="mb-1.5 block text-gray-400">Purchase price</span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">₹</span>
            <input id="fin-purchase-price" inputMode="numeric" value={grpINR(basisForm.purchasePrice)} onChange={(e) => setBasisForm({ ...basisForm, purchasePrice: onlyDigits(e.target.value) })} className="field w-full pl-7 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder="0" />
          </div>
        </label>
        <label className="text-sm"><span className="mb-1.5 block text-gray-400">Purchase date</span><DateField value={basisForm.purchaseDate} onChange={(v) => setBasisForm({ ...basisForm, purchaseDate: v })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" ariaLabel="Purchase date" /></label>
        <label className="text-sm" htmlFor="fin-current-value"><span className="mb-1.5 block text-gray-400">Current value</span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">₹</span>
            <input id="fin-current-value" inputMode="numeric" value={grpINR(basisForm.currentValue)} onChange={(e) => setBasisForm({ ...basisForm, currentValue: onlyDigits(e.target.value) })} className="field w-full pl-7 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder="0" />
          </div>
        </label>
      </div>
    </Modal>
  );
}

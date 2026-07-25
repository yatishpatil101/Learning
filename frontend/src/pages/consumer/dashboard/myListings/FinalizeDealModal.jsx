import Modal from '../../../../components/ui/Modal.jsx';
import DateField from '../../../../components/ui/DateField.jsx';

// Records the closing details when an owner finalizes a sale or rental.
export default function FinalizeDealModal({ listing, dealForm, setDealForm, onFinalize, onClose }) {
  return (
    <Modal open={true} onClose={onClose} title={`Finalize ${listing.deal === 'buy' || listing.deal === 'sale' ? 'Sale' : 'Rental'}`}>
      <div className="space-y-4">
        <p className="text-gray-400 text-sm">Congratulations! Record the deal details for <span className="text-white font-semibold">{listing.title}</span>.</p>
        <label className="block text-sm">
          <span className="text-gray-400 mb-1.5 block">{listing.deal === 'buy' || listing.deal === 'sale' ? 'Buyer' : 'Tenant'} name</span>
          <input value={dealForm.buyerName} onChange={(e) => setDealForm({ ...dealForm, buyerName: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder="Full name" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-400 mb-1.5 block">Mobile number</span>
          <input value={dealForm.buyerMobile} onChange={(e) => setDealForm({ ...dealForm, buyerMobile: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder="10-digit mobile" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-400 mb-1.5 block">Final {listing.deal === 'buy' || listing.deal === 'sale' ? 'sale price' : 'rent'}</span>
          <input type="number" value={dealForm.finalPrice} onChange={(e) => setDealForm({ ...dealForm, finalPrice: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-400 mb-1.5 block">Date</span>
          <DateField value={dealForm.date} onChange={(v) => setDealForm({ ...dealForm, date: v })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" ariaLabel="Deal date" />
        </label>
        <div className="flex gap-3 pt-2">
          <button onClick={onFinalize} className="btn-teal flex-1 py-2.5 rounded-xl text-sm font-semibold">Confirm & Finalize</button>
          <button onClick={onClose} className="btn-outline flex-1 py-2.5 rounded-xl text-sm font-semibold">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

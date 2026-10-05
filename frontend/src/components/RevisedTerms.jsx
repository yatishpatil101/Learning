import { useState } from 'react';
import Icon from './Icon.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { acceptServiceRequestAmendment } from '../services/serviceRequestService.js';
import { openCashfreeCheckout } from '../lib/cashfree.js';
import { fmtINR } from '../lib/format.js';
import { amendmentRows } from '../lib/amendmentTerms.js';
/** Terms our desk revised on a paid rent agreement; drafting waits for the customer to accept them. */

export default function RevisedTerms({ request, onChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { amendment } = request;
  const due = amendment.delta > 0;

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await acceptServiceRequestAmendment(request.id, amendment.id);
      if (updated.paymentSessionId) {
        await openCashfreeCheckout(updated.paymentSessionId);
        toast('We will apply the revised terms as soon as the payment is confirmed.', 'success');
      } else {
        toast('Revised terms accepted. Our team will prepare the draft on them.', 'success');
      }
      onChanged();
    } catch (error) {
      toast(error?.message || 'The revised terms could not be accepted. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs" role="region" aria-label="Revised terms">
      <p className="text-amber-200 font-semibold mb-2 flex items-center gap-1.5">
        <Icon name="alert-triangle" className="w-3.5 h-3.5" /> Our team revised the terms of your agreement
      </p>
      <ul className="space-y-1 text-gray-200">
        {amendmentRows(request.details, amendment.terms).map(([label, before, after]) => (
          <li key={label}>{label}: <span className="text-gray-400 line-through">{before}</span> → <span className="font-semibold text-white">{after}</span></li>
        ))}
      </ul>
      {amendment.reason ? <p className="mt-2 text-gray-300">Why: {amendment.reason}</p> : null}
      <p className="mt-2 text-gray-400">
        {due ? `The fee rises from ${fmtINR(amendment.amountBefore)} to ${fmtINR(amendment.amountAfter)}.`
          : amendment.delta < 0 ? `The fee for these terms is ${fmtINR(amendment.amountAfter)}; nothing more to pay.`
            : 'The fee does not change.'}
        {' '}Your draft is prepared once you accept. Disagree? Message our team.
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="btn-teal mt-2 px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        <Icon name="check" className="w-3.5 h-3.5" />
        {due ? `Pay ${fmtINR(amendment.delta)} and accept` : 'Accept revised terms'}
      </button>
    </div>
  );
}

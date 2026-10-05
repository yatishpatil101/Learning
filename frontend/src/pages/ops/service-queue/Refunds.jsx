import { useEffect, useId, useState } from 'react';
import {
  decideServiceRequestRefund, getServiceRequestRefunds, requestServiceRequestRefund,
} from '../../../services/serviceRequestService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtINR } from '../../../lib/format.js';

const TEXT_MAX = 300;
const GRN = /^MH[0-9A-Z]{8,23}$/;
const field = 'mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white';

function OpenRefund({ refund, busy, onDecide }) {
  const [note, setNote] = useState('');
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-amber-300/20 p-3 text-sm" data-testid="refund-open">
      <p className="text-amber-200">
        {fmtINR(refund.amount)} refund asked for by {refund.requestedBy || 'an operator'}, waiting for approval.
      </p>
      <p className="text-xs text-gray-400">Reason: {refund.reason}</p>
      {refund.dutyPaid ? <p className="text-xs text-gray-400">Stamp duty paid on GRAS, challan {refund.grn}.</p> : null}
      <label className="block text-xs text-gray-400">
        {refund.mine ? 'Why you are withdrawing it' : 'Note (needed to reject)'}
        <textarea rows={2} maxLength={TEXT_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>
      <div className="flex flex-wrap gap-2">
        {refund.mine ? (
          <span className="self-center text-xs text-gray-400">You asked for it, so a colleague has to approve it.</span>
        ) : (
          <button type="button" disabled={busy} onClick={() => onDecide('approve', note)} className="dz-btn dz-btn-primary px-3 py-1.5 text-xs disabled:opacity-40">
            Approve and refund
          </button>
        )}
        <button type="button" disabled={busy || !note.trim()} onClick={() => onDecide('reject', note)} className="dz-btn dz-btn-ghost px-3 py-1.5 text-xs disabled:opacity-40">
          {refund.mine ? 'Withdraw' : 'Reject'}
        </button>
      </div>
    </div>
  );
}

function AskRefund({ summary, busy, onAsk }) {
  const [amount, setAmount] = useState('');
  const [dutyPaid, setDutyPaid] = useState(summary.dutyPaidOnRecord);
  const [grn, setGrn] = useState('');
  const [reason, setReason] = useState('');
  const paidDuty = dutyPaid || summary.dutyPaidOnRecord;
  const max = paidDuty ? summary.refundableAfterDuty : summary.refundableBeforeDuty;
  const needsGrn = paidDuty && !summary.dutyPaidOnRecord;
  const value = Number(amount);
  const valid = value >= 1 && value <= max && reason.trim() && (!needsGrn || GRN.test(grn.replace(/\s/g, '').toUpperCase()));

  const submit = (event) => {
    event.preventDefault();
    if (valid) onAsk({ amount: value, dutyPaid: paidDuty, grn: needsGrn ? grn.replace(/\s/g, '').toUpperCase() : undefined, reason: reason.trim() });
  };

  return (
    <form className="mt-3 space-y-3" onSubmit={submit}>
      <label className="flex items-start gap-2 text-xs text-gray-300">
        <input type="checkbox" checked={paidDuty} disabled={summary.dutyPaidOnRecord} onChange={(e) => setDutyPaid(e.target.checked)} className="mt-0.5" />
        <span>
          The stamp duty is already paid on GRAS
          {summary.dutyPaidOnRecord ? ' (the agreement is registered)' : ''}
        </span>
      </label>
      {needsGrn ? (
        <label className="block text-xs text-gray-400">
          GRAS challan number (GRN)
          <input value={grn} onChange={(e) => setGrn(e.target.value)} placeholder="MH…" maxLength={25} className={field} />
        </label>
      ) : null}
      <label className="block text-xs text-gray-400">
        Amount, up to {fmtINR(max)}
        <input type="number" inputMode="numeric" min={1} max={max} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
      </label>
      <label className="block text-xs text-gray-400">
        Why the money goes back
        <textarea required rows={2} maxLength={TEXT_MAX} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      </label>
      <button type="submit" disabled={busy || !valid} className="dz-btn dz-btn-primary px-3 py-1.5 text-xs disabled:opacity-40">
        Ask for approval
      </button>
    </form>
  );
}

/** D-b refunds: the holder asks, a colleague approves, and only then does the gateway move money. */
export default function Refunds({ request }) {
  const titleId = useId();
  const { toast } = useToast();
  const [summary, setSummary] = useState(null);
  const [failure, setFailure] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    getServiceRequestRefunds(request.id)
      .then((next) => { if (current) setSummary(next); })
      .catch((err) => { if (current) setFailure(err?.message || 'The refunds on this request could not be read.'); });
    return () => { current = false; };
  }, [request.id]);

  const run = async (call, success) => {
    if (busy) return;
    setBusy(true);
    try {
      setSummary(await call());
      setAsking(false);
      toast(success, 'success');
    } catch (err) {
      toast(err?.message || 'The refund was not changed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!failure && (!summary || (summary.paid === 0 && summary.refunds.length === 0))) return null;

  const open = summary?.refunds.find((r) => r.status === 'requested');
  const decided = summary?.refunds.filter((r) => r.status !== 'requested') || [];

  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby={titleId}>
      <h4 id={titleId} className="text-sm font-semibold">Refunds</h4>
      {failure ? <p role="alert" className="mt-2 text-sm text-amber-200">{failure}</p> : null}
      {summary ? (
        <>
          <p className="mt-2 text-sm text-gray-300" data-testid="refund-figures">
            Paid {fmtINR(summary.paid)} · refunded {fmtINR(summary.refunded)} ·{' '}
            {summary.dutyPaidOnRecord
              ? `registered, so the duty is spent: up to ${fmtINR(summary.refundableAfterDuty)} can go back`
              : `up to ${fmtINR(summary.refundableBeforeDuty)} can go back, ${fmtINR(summary.refundableAfterDuty)} once the stamp duty is paid`}
          </p>

          {open ? (
            <OpenRefund
              key={open.id}
              refund={open}
              busy={busy}
              onDecide={(decision, note) => run(
                () => decideServiceRequestRefund(request.id, open.id, decision, note.trim()),
                decision === 'approve' ? 'Refund sent to the payment gateway.' : 'Refund closed without paying.',
              )}
            />
          ) : null}

          {!open && !asking && summary.refundableBeforeDuty > 0 ? (
            <button type="button" onClick={() => setAsking(true)} className="dz-btn dz-btn-ghost mt-3 px-3 py-1.5 text-xs">Ask for a refund</button>
          ) : null}
          {!open && asking ? (
            <AskRefund
              summary={summary}
              busy={busy}
              onAsk={(body) => run(() => requestServiceRequestRefund(request.id, body), 'Refund asked for. A colleague must approve it.')}
            />
          ) : null}

          {decided.length ? (
            <ul className="mt-3 space-y-1 text-xs text-gray-400">
              {decided.map((r) => (
                <li key={r.id}>
                  {fmtINR(r.amount)} {r.status} by {r.decidedBy || 'an operator'}
                  {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                  {r.gatewayRefundId ? ` (gateway ref ${r.gatewayRefundId})` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

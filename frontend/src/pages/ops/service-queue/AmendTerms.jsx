import { useId, useState } from 'react';
import {
  proposeServiceRequestAmendment, withdrawServiceRequestAmendment,
} from '../../../services/serviceRequestService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtINR } from '../../../lib/format.js';
import { AMENDABLE_TERMS, amendmentRows, currentTerm } from '../../../lib/amendmentTerms.js';

const AMENDABLE = new Set(['docs_review', 'changes_requested']);
const REASON_MAX = 300;

function Owed({ delta }) {
  if (delta > 0) return <>The customer pays {fmtINR(delta)} more before the draft can be shared.</>;
  if (delta < 0) return <>The fee drops by {fmtINR(-delta)}; what was already paid stays on record.</>;
  return <>The fee does not change.</>;
}

/** The desk re-prices a paid rent agreement; the customer accepts (and pays any difference) before drafting goes on. */
export default function AmendTerms({ request, onUpdated }) {
  const titleId = useId();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const open = request.amendment;

  if (!open && !AMENDABLE.has(request.status)) return null;

  const start = () => {
    setValues(Object.fromEntries(AMENDABLE_TERMS.map((t) => [t.key, currentTerm(request.details, t.key)])));
    setReason('');
    setEditing(true);
  };

  const changes = () => Object.fromEntries(AMENDABLE_TERMS
    .filter((t) => values[t.key] !== '' && values[t.key] !== currentTerm(request.details, t.key))
    .map((t) => [t.key, t.options ? values[t.key] : Number(values[t.key])]));

  const run = async (call, success) => {
    if (busy) return;
    setBusy(true);
    try {
      onUpdated(await call());
      setEditing(false);
      toast(success, 'success');
    } catch (err) {
      toast(err?.message || 'The terms were not changed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const next = changes();
    if (Object.keys(next).length === 0) { toast('Change at least one term first.', 'error'); return; }
    run(() => proposeServiceRequestAmendment(request.id, { ...next, reason: reason.trim() }),
      'Revised terms sent. The customer must accept them before the draft is shared.');
  };

  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby={titleId}>
      <h4 id={titleId} className="text-sm font-semibold">Priced terms</h4>

      {open ? (
        <div className="mt-2 space-y-2 text-sm" data-testid="amendment-open">
          <p className="text-amber-200">Revised terms are waiting for the customer.</p>
          <ul className="space-y-1 text-xs text-gray-300">
            {amendmentRows(request.details, open.terms).map(([label, before, after]) => (
              <li key={label}>{label}: {before} → <span className="font-semibold text-white">{after}</span></li>
            ))}
          </ul>
          <p className="text-xs text-gray-400"><Owed delta={open.delta} />{open.checkoutOpen ? ' A payment is in progress.' : ''}</p>
          <p className="text-xs text-gray-400">Reason given: {open.reason}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => withdrawServiceRequestAmendment(request.id, open.id), 'Revised terms withdrawn.')}
            className="dz-btn dz-btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Withdraw revised terms
          </button>
        </div>
      ) : null}

      {!open && !editing ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-400">
          <span>Rent, deposit, term or registration area wrong on the paid request? Revise them here; the customer accepts first.</span>
          <button type="button" onClick={start} className="dz-btn dz-btn-ghost px-3 py-1.5 text-xs">Revise priced terms</button>
        </div>
      ) : null}

      {!open && editing ? (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {AMENDABLE_TERMS.map((t) => (
              <label key={t.key} className="text-xs text-gray-400">
                {t.label}
                {t.options ? (
                  <select
                    value={values[t.key] ?? ''}
                    onChange={(event) => setValues((v) => ({ ...v, [t.key]: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
                  >
                    {t.options.map((o) => <option key={o} value={o}>{t.show(o)}</option>)}
                  </select>
                ) : (
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={t.key === 'increment' ? 100 : undefined}
                    step={t.key === 'increment' ? '0.5' : '1'}
                    value={values[t.key] ?? ''}
                    onChange={(event) => setValues((v) => ({ ...v, [t.key]: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
                  />
                )}
              </label>
            ))}
          </div>
          <label className="block text-xs text-gray-400">
            Why the terms change (the customer reads this)
            <textarea
              required
              rows={2}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !reason.trim()} className="dz-btn dz-btn-primary px-3 py-1.5 text-xs disabled:opacity-40">Send to customer</button>
            <button type="button" onClick={() => setEditing(false)} className="dz-btn dz-btn-ghost px-3 py-1.5 text-xs">Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

import { useState } from 'react';

const REASONS = {
  rent_ge_50000: 'Rent is ₹50k or more',
  co_owner: 'Co-owner is named',
  poa: 'Power of attorney is used',
  nri_or_foreign: 'NRI / foreign party',
  overlap: 'MOD-7 overlap',
};

export default function DraftSecondCheck({ request, onDecide }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const decide = async (decision) => {
    if (busy || (decision === 'send-back' && !note.trim())) return;
    setBusy(decision);
    try {
      await onDecide(decision, note);
      setNote('');
    } catch {
      // The caller toasts the failure; the note stays for another try.
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
      <h4 className="text-sm font-semibold text-amber-100">Second-operator draft check</h4>
      <p className="mt-1 text-sm text-amber-100/80">This risky draft is waiting for a colleague before the customer can see it.</p>
      <ul className="mt-2 list-disc pl-5 text-xs text-amber-100/80">
        {(request.draftCheck.reasons || []).map((reason) => <li key={reason}>{REASONS[reason] || reason}</li>)}
      </ul>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} aria-label="Reason for sending back" className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="Note if sending back" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => decide('release')} disabled={!!busy} className="dz-btn dz-btn-primary disabled:opacity-40">{busy === 'release' ? 'Releasing…' : 'Check and release'}</button>
        <button type="button" onClick={() => decide('send-back')} disabled={!!busy || !note.trim()} className="dz-btn dz-btn-ghost disabled:opacity-40">{busy === 'send-back' ? 'Sending…' : 'Send back'}</button>
      </div>
    </section>
  );
}

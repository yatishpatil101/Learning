import { missingEvidenceId } from './vocabulary.js';

/* One choice seen from either side, so whichever decision is available the other is not. Grant is
   always a deliberate click, never a consequence of recording evidence. */
export default function BadgeDecisions({
  id, verification, pending, canDecide, reason, setReason, onGrant, onWithdraw,
}) {
  const blocked = verification.missingKinds.length > 0;
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-gray-400">The badge is shown to every visitor on the public listing. Grant it only once the documents above have been opened and compared.</p>
      {!verification.verified && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" disabled={Boolean(pending) || !canDecide || blocked}
            aria-describedby={blocked ? missingEvidenceId(id) : undefined}
            className="dz-btn dz-btn-success min-h-[44px]" onClick={onGrant}>
            {pending === 'grant' ? 'Granting ownership verification…' : 'Grant ownership verification'}
          </button>
          {blocked && <p className="text-xs text-amber-200">Blocked until the evidence listed under “Ownership not verified” is recorded.</p>}
        </div>
      )}
      {verification.verified && <form aria-label="Withdraw ownership verification" onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim()) onWithdraw(reason.trim());
      }} className="space-y-2 rounded-lg border border-rose-400/25 bg-rose-500/[0.05] p-3">
        <label htmlFor={`${id}-reason`} className="block text-[11px] font-bold uppercase tracking-wide text-gray-400">Reason for withdrawal</label>
        <textarea id={`${id}-reason`} required value={reason} disabled={Boolean(pending) || !canDecide}
          aria-describedby={`${id}-reason-help`} placeholder="What did the second look find?"
          onChange={(event) => setReason(event.target.value)} rows={2} className="dz-input resize-none" />
        <p id={`${id}-reason-help`} className="text-xs text-gray-500">Saved to the audit trail. The badge disappears from the public listing immediately.</p>
        <button type="submit" disabled={Boolean(pending) || !canDecide || !reason.trim()} className="dz-btn dz-btn-danger min-h-[44px]">
          {pending === 'revoke' ? 'Withdrawing verification…' : 'Withdraw ownership verification'}
        </button>
      </form>}
    </div>
  );
}

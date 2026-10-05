import { missingEvidenceId } from './vocabulary.js';

/* Grant and withdraw are never both on offer, and grant is always a deliberate click, never a
   consequence of recording evidence. */
export default function BadgeDecisions({
  id, verification, pending, canDecide, reason, setReason, onGrant, onWithdraw,
}) {
  const blocked = verification.missingKinds.length > 0;
  if (!verification.verified) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" disabled={Boolean(pending) || !canDecide || blocked}
          aria-describedby={blocked ? missingEvidenceId(id) : undefined}
          className="dz-btn dz-btn-success" onClick={onGrant}>
          {pending === 'grant' ? 'Granting ownership verification…' : 'Grant ownership verification'}
        </button>
        <p className={blocked ? 'text-xs text-amber-200' : 'text-xs text-gray-500'}>
          {blocked ? 'Record the missing evidence first.' : 'Every visitor sees the badge on the public listing.'}
        </p>
      </div>
    );
  }
  return (
    <form aria-label="Withdraw ownership verification" className="space-y-1.5" onSubmit={(event) => {
      event.preventDefault();
      if (reason.trim()) onWithdraw(reason.trim());
    }}>
      <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-gray-400">Reason for withdrawal</label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <textarea id={`${id}-reason`} required value={reason} disabled={Boolean(pending) || !canDecide}
          aria-describedby={`${id}-reason-help`} placeholder="What did the second look find?"
          onChange={(event) => setReason(event.target.value)} rows={2} className="dz-input flex-1 resize-none" />
        <button type="submit" disabled={Boolean(pending) || !canDecide || !reason.trim()} className="dz-btn dz-btn-danger shrink-0">
          {pending === 'revoke' ? 'Withdrawing verification…' : 'Withdraw ownership verification'}
        </button>
      </div>
      <p id={`${id}-reason-help`} className="text-xs text-gray-500">Saved to the audit trail. The badge disappears from the public listing immediately.</p>
    </form>
  );
}

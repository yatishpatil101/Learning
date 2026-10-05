import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { declineOwnershipVerification } from '../../../../services/propertyReviewService.js';
import { useToast } from '../../../../context/ToastContext.jsx';
import { fmtAgo } from '../constants.js';

/* Granting in the badge section below answers the request; this is the other answer. The listing's
   status is untouched, so it works the same on a live, paused or pending listing. */
export default function BadgeRequestBanner({ propertyId, requestedAt, onDeclined }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const decline = async () => {
    if (busy || !reason.trim()) return;
    setBusy(true);
    try {
      await declineOwnershipVerification(propertyId, reason.trim());
      toast('Badge request declined - the owner has been told why', 'success');
      onDeclined();
    } catch (err) {
      toast(err?.message || 'Could not decline the badge request', 'error');
      setBusy(false);
    }
  };

  return (
    <div data-testid="badge-request-banner" className="rounded-2xl border border-indigo-400/30 bg-indigo-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-indigo-100">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Owner is seeking the Verified property badge
      </div>
      <p className="mt-1 text-xs text-indigo-100/80">
        Requested{requestedAt ? ` ${fmtAgo(requestedAt)}` : ''}. Check the papers in the badge section below, then grant or decline.
      </p>
      {open ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-indigo-100" htmlFor="badge-decline-reason">Reason the owner will see</label>
          <textarea id="badge-decline-reason" data-testid="badge-decline-reason" value={reason} maxLength={300} rows={2}
            onChange={(e) => setReason(e.target.value)} placeholder="e.g. The bill is for a different flat"
            className="dz-input resize-none" />
          <div className="flex gap-2">
            <button type="button" onClick={decline} disabled={busy || !reason.trim()} className="dz-btn dz-btn-danger dz-btn-sm" data-testid="confirm-badge-decline">
              {busy ? 'Declining…' : 'Decline request'}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="dz-btn dz-btn-ghost dz-btn-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="dz-btn dz-btn-ghost dz-btn-sm mt-3" data-testid="decline-badge-request">
          Decline badge request
        </button>
      )}
    </div>
  );
}

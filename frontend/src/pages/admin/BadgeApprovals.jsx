import { useState } from 'react';
import { approveBadgeGrant, rejectBadgeGrant } from '../../services/usersService.js';
import { classNames, timeAgo } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { BTN, CHIP, CHIP_TONE, FactRow, RowCard, RowList } from '../../components/admin/WorkQueue.jsx';

export default function BadgeApprovals({ requests, currentUser, onReload }) {
  const { toast } = useToast();
  const [decision, setDecision] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const closeDecision = () => {
    setDecision(null);
    setText('');
    setError('');
  };

  const canDecide = (request) =>
    String(request.requestedBy) !== String(currentUser?.id) && String(request.userId) !== String(currentUser?.id);

  const openDecision = (request, action) => {
    setDecision({ request, action });
    setText('');
    setError('');
  };

  const confirmDecision = async () => {
    if (!decision || busy) return;
    const note = text.trim();
    if (decision.action === 'reject' && (note.length < 10 || note.length > 300)) return;
    setBusy(true);
    setError('');
    try {
      if (decision.action === 'approve') await approveBadgeGrant(decision.request.id, note);
      else await rejectBadgeGrant(decision.request.id, note);
      toast(decision.action === 'approve' ? 'Badge request approved' : 'Badge request rejected', 'success');
      closeDecision();
      await onReload();
    } catch (err) {
      const message = err?.message || 'That badge request could not be decided';
      setError(message);
      toast(message, 'error');
      await onReload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <RowList isEmpty={!requests.length} empty="No badge requests pending.">
        {requests.map((request) => (
          <RowCard
            key={request.id}
            id={request.id}
            testId="admin-badge-grant-row"
            title={request.userName || request.userMobileMasked || request.userId}
            meta={(
              <>
                <span>{request.userMobileMasked || '—'}</span>
                <span className="text-gray-600" aria-hidden="true">·</span>
                <span>requested by {request.requestedByName || request.requestedBy || '—'}</span>
                <span className="text-gray-600" aria-hidden="true">·</span>
                <span>{request.createdAt ? timeAgo(request.createdAt) : '—'}</span>
              </>
            )}
            facts={<FactRow label="Reason"><span className="col-span-full">{request.reason}</span></FactRow>}
            primary={canDecide(request) ? (
              <>
                <button type="button" onClick={() => openDecision(request, 'approve')} className={BTN.primary}>Approve</button>
                <button type="button" onClick={() => openDecision(request, 'reject')} className={BTN.danger}>Reject</button>
              </>
            ) : (
              <span className={classNames(CHIP, CHIP_TONE.neutral)}>Waiting for another admin</span>
            )}
          />
        ))}
      </RowList>

      <Modal
        open={!!decision}
        onClose={closeDecision}
        title={decision?.action === 'approve' ? 'Approve badge request' : 'Reject badge request'}
        footer={
          <>
            <button onClick={closeDecision} className="dz-btn dz-btn-ghost">Cancel</button>
            <button
              onClick={confirmDecision}
              disabled={busy || (decision?.action === 'reject' && (text.trim().length < 10 || text.trim().length > 300))}
              className="dz-btn dz-btn-primary disabled:opacity-50"
            >
              {busy ? 'Working…' : decision?.action === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </>
        }
      >
        {decision ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">
              {decision.request.userName || decision.request.userMobileMasked} · requested by {decision.request.requestedByName || decision.request.requestedBy}
            </p>
            <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-300">{decision.request.reason}</p>
            {error ? <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div> : null}
            <label className="block">
              <span className="text-xs text-gray-400">{decision.action === 'approve' ? 'Note (optional)' : 'Reject reason (required)'}</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                className="mt-1 dz-input resize-none text-sm"
              />
            </label>
            {decision.action === 'reject' && (text.trim().length < 10 || text.trim().length > 300) ? (
              <p className="text-xs text-amber-300">Reason must be 10–300 characters.</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

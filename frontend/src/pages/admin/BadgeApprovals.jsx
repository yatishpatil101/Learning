import { useState } from 'react';
import { approveBadgeGrant, rejectBadgeGrant } from '../../services/usersService.js';
import { timeAgo } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import Modal from '../../components/ui/Modal.jsx';

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
      <section data-testid="admin-badge-approvals" className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">Badge approvals</h2>
            <p className="mt-0.5 text-xs text-gray-500">Hand-granted badges need a second admin.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300">{requests.length} pending</span>
        </div>
        <div className="mt-3 space-y-2">
          {requests.map((request) => {
            const showActions = canDecide(request);
            return (
              <div key={request.id} data-testid="admin-badge-grant-row" className="rounded-xl border border-white/10 bg-black/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{request.userName || request.userMobileMasked || request.userId}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{request.userMobileMasked || '—'} · requested by {request.requestedByName || request.requestedBy || '—'} · {request.createdAt ? timeAgo(request.createdAt) : '—'}</p>
                    <p className="mt-2 text-xs text-gray-300">{request.reason}</p>
                  </div>
                  {showActions ? (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openDecision(request, 'approve')} className="rounded-[10px] border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200">Approve</button>
                      <button type="button" onClick={() => openDecision(request, 'reject')} className="rounded-[10px] border border-rose-400/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200">Reject</button>
                    </div>
                  ) : (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-400">Waiting for another admin</span>
                  )}
                </div>
              </div>
            );
          })}
          {requests.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-gray-500">No badge requests pending.</div> : null}
        </div>
      </section>

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

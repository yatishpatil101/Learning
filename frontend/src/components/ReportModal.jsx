import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { createReport } from '../services/reportService.js';
import { LISTING_REPORT_REASONS } from '../lib/reportReasons.js';
import useScrollLock from '../hooks/useScrollLock.js';

/* **`kind` must match the reason set**: the server validates the reason against the target type,
   so `SHARE_REPORT_REASONS` needs `kind="share"` and not `"user"`. */

export default function ReportModal({
  target,
  kind = 'listing',
  reasons = LISTING_REPORT_REASONS,
  title = 'Report this listing',
  subtitle = 'Help us keep Draazy safe. Reports are confidential.',
  success = 'Thanks — our team will review this listing.',
  onClose,
  toast,
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  useScrollLock();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    /* The modal stays open on failure so the report is not lost with it: a 409 duplicate or any
       other refusal must not be thanked, since the reporter would assume it was heard. */
    let result;
    try {
      result = await createReport({
        kind,
        targetId: target?.id,
        targetTitle: target?.title,
        targetOwner: target?.ownerName,
        ownerMobile: target?.ownerMobile,
        reason,
        details: details.trim(),
        url: window.location.href,
      });
    } catch {
      setSending(false);
      toast('Your report could not be sent. Please try again.', 'error');
      return;
    }
    setSending(false);
    if (result === 'duplicate') {
      onClose();
      toast('You have already reported this — our team is still reviewing it.', 'info');
      return;
    }
    onClose();
    toast(success, 'success');
  };

  return (
    <div className="dz-modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dz-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="dz-modal-x" aria-label="Close"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2 mb-4">
          {reasons.map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setReason(k)} className={'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border text-sm text-left transition-smooth ' + (reason === k ? 'border-brand-teal-2/50 bg-brand-teal-1/10 text-white' : 'border-white/10 text-slate-300 hover:bg-white/5')}>
              <span className={'w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ' + (reason === k ? 'border-brand-teal-3' : 'border-white/30')}>{reason === k ? <span className="w-2 h-2 rounded-full bg-brand-teal-3" /> : null}</span>
              {lbl}
            </button>
          ))}
        </div>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={600} placeholder="Add any details (optional)" className="w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-teal-2/50 mb-4" />
        <button type="button" onClick={submit} disabled={!reason} className={'btn-teal w-full flex items-center justify-center gap-2 py-3 ' + (!reason ? 'opacity-50 cursor-not-allowed' : '')}><Icon name="flag" className="w-4 h-4" /> Submit report</button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { submitReport } from '../lib/data/reports.js';
import { myMobile } from '../lib/store.js';

/* Platform-wide "Report this…" modal. One component powers reporting of property
   listings, flatmate/room/group posts, and anything else that needs moderation.
   Callers pass a `target` ({ id, title, ownerName, ownerMobile }), a `kind`
   ('listing' | 'user') that maps onto the admin moderation tabs, and optionally a
   reason set + copy. Every submission flows through submitReport() into the shared
   reports collection the admin queue reads. */

export const LISTING_REPORT_REASONS = [
  ['sold', 'Already sold or rented out'],
  ['fake', 'Fake photos or misleading info'],
  ['unavailable', 'Owner not responding / unreachable'],
  ['pricing', 'Overpriced / incorrect price'],
  ['spam', 'Spam or duplicate listing'],
  ['broker', 'Posted by a broker / not the owner'],
  ['other', 'Something else'],
];

export const SHARE_REPORT_REASONS = [
  ['fake', 'Fake or misleading profile'],
  ['unavailable', 'Not responding / unreachable'],
  ['filled', 'Already filled / no longer available'],
  ['broker', 'Broker or agent, not a genuine seeker'],
  ['inappropriate', 'Inappropriate or offensive content'],
  ['spam', 'Spam or duplicate post'],
  ['other', 'Something else'],
];

export const OWNER_REPORT_REASONS = [
  ['impersonation', 'Fake or impersonated profile'],
  ['fraud', 'Suspected fraud or scam'],
  ['brokerage', 'Asked for brokerage / advance payment'],
  ['abuse', 'Abusive or harassing behaviour'],
  ['spam', 'Spam or irrelevant messages'],
  ['fakelistings', 'Listings are fake or unavailable'],
  ['other', 'Something else'],
];

export default function ReportModal({
  target,
  kind = 'listing',
  reasons = LISTING_REPORT_REASONS,
  title = 'Report this listing',
  subtitle = 'Help us keep PuneNest safe. Reports are confidential.',
  success = 'Thanks — our team will review this listing.',
  onClose,
  toast,
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const submit = () => {
    if (!reason) return;
    const reasonLabel = reasons.find(([k]) => k === reason)?.[1] || reason;
    submitReport({
      listingId: target?.id,
      listingTitle: target?.title,
      ownerName: target?.ownerName,
      ownerMobile: target?.ownerMobile,
      reason,
      reasonLabel,
      details: details.trim(),
      reportedBy: 'User',
      reporterMobile: myMobile() || '',
      url: window.location.href,
      kind,
    });
    onClose();
    toast(success, 'success');
  };

  return (
    <div className="pn-modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pn-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="pn-modal-x" aria-label="Close"><Icon name="x" className="w-5 h-5" /></button>
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

import { useState } from 'react';
import { BadgeCheck, Check, FileText, Flag, KeyRound, ShieldCheck, X } from 'lucide-react';
import Badge from '../../../../components/ui/Badge.jsx';
import { openDocUrl } from '../../../../lib/openDoc.js';
import { Block, fmtDate } from '../board.jsx';

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const OK = `${chip} border-emerald-400/30 bg-emerald-500/10 text-emerald-300`;
const WARN = `${chip} border-amber-400/30 bg-amber-500/10 text-amber-300`;
const NEUTRAL = `${chip} border-white/10 bg-white/5 text-gray-300`;

function AgreementChip({ review: r }) {
  if (r.agreementViewable) {
    return (
      <button type="button" onClick={() => openDocUrl(r.agreementDoc.dataUrl)} className={`view-agreement-btn ${chip} border-brand-teal/30 bg-brand-teal/10 text-brand-teal`}>
        <FileText className="h-3 w-3" />View agreement
      </button>
    );
  }
  if (r.agreementDoc) {
    return <span className={NEUTRAL}><FileText className="h-3 w-3" />{r.agreementTooLarge ? 'Agreement too large to preview' : 'Agreement on file'}</span>;
  }
  return r.tier === 'tenant' ? <span className={WARN}><X className="h-3 w-3" />No agreement</span> : null;
}

/* The badge axis: approving grants "Ops-verified", rejecting withholds the badge and nothing else.
   A rejection needs a reason — the server and database both refuse one without. */
export default function BadgeSection({ review: r, busy, onDecide }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const pending = r.status === 'pending';

  return (
    <Block icon={ShieldCheck} title="Badge verification" aside={<Badge status={r.status} />} className="flatmate-badge-section">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${chip} border-brand-teal/30 bg-brand-teal/10 capitalize text-brand-teal`}>
          <KeyRound className="h-3 w-3" />{r.tier}-tier claim
        </span>
        <AgreementChip review={r} />
        {r.ownerConsent ? (
          <span className={OK}><Check className="h-3 w-3" />Owner consent</span>
        ) : r.tier === 'tenant' ? (
          // Approval is refused with a 422 until the owner answers the OTP; say so before the click.
          <span className={WARN} data-testid="consent-missing"><X className="h-3 w-3" />Owner consent missing</span>
        ) : null}
        {r.flagForReview ? <span className={WARN}><Flag className="h-3 w-3" />Contested address</span> : null}
      </div>

      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="text-gray-400">Address</dt>
        <dd className="break-words text-gray-100">{r.address || '—'}</dd>
        <dt className="text-gray-400">Claimed by</dt>
        <dd className="text-gray-100">{r.host || '—'} <span className="text-gray-400">{r.hostMobile || ''}</span> · {fmtDate(r.createdAt)}</dd>
        {r.agreementRegNo ? (
          <>
            <dt className="text-gray-400">Registration</dt>
            <dd className="text-gray-300" data-testid="agreement-registration">
              <span className="font-mono text-gray-100">{r.agreementRegNo}</span>
              {r.agreementRegisteredOn ? <span> · registered {r.agreementRegisteredOn}</span> : null}
              {r.agreementValidTill ? <span> · valid till {r.agreementValidTill}</span> : null}
            </dd>
          </>
        ) : null}
        {r.status === 'rejected' && r.reason ? (
          <>
            <dt className="text-gray-400">Rejected because</dt>
            <dd className="text-rose-300">{r.reason}</dd>
          </>
        ) : null}
      </dl>

      {pending && !rejecting ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => onDecide('approved')} className="approve-review-btn dz-btn dz-btn-success">
            <BadgeCheck className="h-4 w-4" />Approve badge
          </button>
          <button type="button" disabled={busy} onClick={() => { setRejecting(true); setReason(''); }} className="reject-review-btn dz-btn dz-btn-ghost">
            <X className="h-4 w-4" />Reject badge
          </button>
        </div>
      ) : null}

      {pending && rejecting ? (
        <div className="mt-3 space-y-2">
          <textarea
            autoFocus
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection"
            aria-label="Reason for rejection"
            className="dz-input w-full"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => onDecide('rejected', reason.trim())}
              className="dz-btn dz-btn-danger"
            >
              Confirm rejection
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="dz-btn dz-btn-ghost">Cancel</button>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-gray-500">The badge only. Rejecting it does not take the post down.</p>
    </Block>
  );
}

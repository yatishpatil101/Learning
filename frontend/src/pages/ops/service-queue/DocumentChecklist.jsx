import { useState } from 'react';
import { Check, ExternalLink, Minus, ShieldAlert, X } from 'lucide-react';
import { reviewServiceRequestDocument } from '../../../services/serviceRequestService.js';
import { classNames, fmtNum } from '../../../lib/format.js';

const REVIEWABLE = new Set(['docs_review', 'draft_shared', 'changes_requested', 'approved']);
const REASON_MAX = 300;

const STATE_LABEL = { verified: 'verified', rejected: 'rejected', pending: 'received, not yet verified' };

function RowIcon({ item }) {
  if (item.review === 'verified') return <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />;
  if (item.review === 'rejected') return <X className="h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />;
  if (item.done) return <Check className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />;
  return <Minus className="h-4 w-4 shrink-0 text-gray-600" aria-hidden="true" />;
}

/** One review in flight per request, so a late response cannot overwrite a newer checklist. */
export function usePaperReview(request, onChange, onError) {
  const [busy, setBusy] = useState('');
  const gated = request.type === 'rental';
  const decide = async (item, verdict, why) => {
    if (busy) return false;
    setBusy(item.id);
    try {
      onChange(await reviewServiceRequestDocument(request.id, item.id, { documentId: item.documentId, verdict, reason: why }));
      return true;
    } catch (err) {
      onError(err?.message || 'The review was not saved.');
      return false;
    } finally {
      setBusy('');
    }
  };
  return { busy, decide, gated, canReview: gated && REVIEWABLE.has(request.status) };
}

export const papersCount = (checklist, gated) => {
  const verified = checklist.items.filter((i) => i.review === 'verified').length;
  return `${fmtNum(checklist.ready)} of ${fmtNum(checklist.total)} received${gated ? ` · ${fmtNum(verified)} verified` : ''}`;
};

/** `label` is the short name shown inside a party's card; buttons keep the full name for screen readers. */
export function PaperRow({ item, label = item.name, review, file, onOpen }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, decide, gated, canReview } = review;
  const send = async (verdict, why) => {
    if (await decide(item, verdict, why)) {
      setRejecting(false);
      setReason('');
    }
  };

  return (
    <li className="border-b border-white/5 py-1 text-sm last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <RowIcon item={item} />
        <span className={classNames('flex-1', item.done ? 'text-gray-200' : 'text-gray-500')}>{label}</span>
        <span className={gated && item.done ? 'text-xs text-gray-400' : 'sr-only'}>
          {item.done ? (gated ? STATE_LABEL[item.review] || STATE_LABEL.pending : 'received') : 'not received'}
        </span>
        {file ? (
          <button type="button" onClick={() => onOpen(file)} className="dz-btn dz-btn-ghost px-2 py-1 text-xs" aria-label={`Open ${item.name}`}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
          </button>
        ) : null}
        {canReview && item.documentId && !rejecting ? (
          <span className="flex gap-1">
            {item.review !== 'verified' ? (
              <button type="button" disabled={!!busy} onClick={() => send('verified')} className="dz-btn dz-btn-ghost px-2 py-1 text-xs disabled:opacity-40" aria-label={`Verify ${item.name}`}>Verify</button>
            ) : null}
            {item.review !== 'rejected' ? (
              <button type="button" disabled={!!busy} onClick={() => { setRejecting(true); setReason(''); }} className="dz-btn dz-btn-ghost px-2 py-1 text-xs disabled:opacity-40" aria-label={`Reject ${item.name}`}>Reject</button>
            ) : null}
          </span>
        ) : null}
      </div>
      {item.review === 'rejected' && item.reason ? (
        <p className="mt-1 pl-6 text-xs text-rose-300">Sent back: {item.reason}</p>
      ) : null}
      {rejecting ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2 pl-6"
          onSubmit={(event) => { event.preventDefault(); if (reason.trim()) send('rejected', reason.trim()); }}
        >
          <label className="sr-only" htmlFor={`reject-${item.id}`}>Why is {item.name} rejected?</label>
          <input
            id={`reject-${item.id}`}
            value={reason}
            maxLength={REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What the customer must fix — they read this"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs"
          />
          <button type="submit" disabled={!reason.trim() || !!busy} className="dz-btn dz-btn-primary px-2 py-1 text-xs disabled:opacity-40">Send back</button>
          <button type="button" onClick={() => setRejecting(false)} className="dz-btn dz-btn-ghost px-2 py-1 text-xs">Cancel</button>
        </form>
      ) : null}
    </li>
  );
}

/** Loading, read failure, and what the counts mean — everything about the checklist except its rows. */
export function PapersNotice({ checklist, status, review }) {
  const verified = status === 'ready' ? checklist.items.filter((i) => i.review === 'verified').length : 0;
  return (
    <>
      {status === 'loading' ? <p className="mt-3 text-sm text-gray-500">Checking what has been filed…</p> : null}
      {status === 'error' ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {/* Not "no documents": we do not know that, and saying it sends somebody chasing paperwork already sent. */}
          <span>The document list could not be read, so this is not a list of what is missing. Try again before asking the customer for anything.</span>
        </div>
      ) : null}
      {status === 'ready' && checklist.ready < checklist.total ? (
        <p className="mt-3 text-xs text-gray-400">Missing items are the customer&rsquo;s to upload.</p>
      ) : null}
      {review.canReview && status === 'ready' && verified < checklist.total ? (
        <p className="mt-1 text-xs text-gray-400">The draft and the registered copy wait until every paper is verified.</p>
      ) : null}
    </>
  );
}

export default function DocumentChecklist({ request, checklist, status, onChange, onError, children }) {
  const review = usePaperReview(request, onChange, onError);
  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby="documents-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="documents-title" className="text-sm font-semibold">Documents</h4>
        {status === 'ready' ? <span className="text-sm text-gray-400">{papersCount(checklist, review.gated)}</span> : null}
      </div>
      {status === 'ready' ? (
        <ul className="mt-3 space-y-1.5">
          {checklist.items.map((it) => <PaperRow key={it.id} item={it} review={review} />)}
        </ul>
      ) : null}
      <PapersNotice checklist={checklist} status={status} review={review} />
      {children}
    </section>
  );
}
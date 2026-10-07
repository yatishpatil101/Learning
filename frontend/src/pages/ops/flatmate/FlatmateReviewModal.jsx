import { useCallback, useEffect, useState } from 'react';
import { MapPin, Pencil, Users } from 'lucide-react';
import Modal from '../../../components/ui/Modal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtINR } from '../../../lib/format.js';
import {
  decideFlatmateReview,
  editFlatmateAsModerator,
  getFlatmateModerationDetail,
  moderateFlatmatePost,
  moderateGroupApplication,
} from '../../../services/flatmateService.js';
import { Block, fmtDate } from './board.jsx';
import { entryKind, entrySummary } from './FlatmateQueueCard.jsx';
import PostDetails from './review-modal/PostDetails.jsx';
import EditDetails from './review-modal/EditDetails.jsx';
import BadgeSection from './review-modal/BadgeSection.jsx';
import DecisionSection from './review-modal/DecisionSection.jsx';

const KIND_LABEL = { post: 'Seeker post', room: 'Room', group: 'Group' };

function priceOf({ room, group, post }) {
  if (room?.budget) return `${fmtINR(room.budget)}/mo`;
  if (group?.rent) return `${fmtINR(group.rent)}/mo`;
  if (post?.budget) return `up to ${fmtINR(post.budgetMax || post.budget)}/mo`;
  return '';
}

function Header({ title, kindLabel, locality, price, chips }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-teal-500/10 to-indigo-500/10 p-4">
      <div className="min-w-0">
        <div className="break-words text-lg font-extrabold text-white">{title || 'Untitled'}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-gray-300">{kindLabel}</span>
          {chips}
        </div>
        {locality ? (
          <div className="mt-2 flex items-center gap-1 text-sm text-gray-300"><MapPin className="h-3.5 w-3.5" />{locality}</div>
        ) : null}
      </div>
      {price ? <div className="text-2xl font-extrabold text-teal-300">{price}</div> : null}
    </div>
  );
}

function ApplicationBody({ app, busy, onDecide }) {
  return (
    <>
      <Header
        title={app.groupTitle || 'Group application'}
        kindLabel="Group application"
        locality={app.locality}
        price={app.rent == null ? '' : `${fmtINR(app.rent)}/mo`}
        chips={<Badge status={app.status}>{`Owner: ${app.status}`}</Badge>}
      />
      <Block icon={Users} title="Application">
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-gray-400">Applying to</dt><dd className="break-words text-gray-100">{app.listingTitle || '—'}</dd>
          <dt className="text-gray-400">Applicant</dt><dd className="text-gray-100">{app.applicantName || '—'}</dd>
          <dt className="text-gray-400">Group size</dt><dd className="text-gray-100">{app.members} of {app.seatsTotal} seats</dd>
          <dt className="text-gray-400">Per head</dt><dd className="text-gray-100">{app.perHead == null ? '—' : fmtINR(app.perHead)}</dd>
          <dt className="text-gray-400">Applied</dt><dd className="text-gray-100">{fmtDate(app.at)}</dd>
        </dl>
        <p className="mt-3 text-xs text-gray-500">The owner&apos;s accept or decline is theirs. This desk only decides whether the application may stand.</p>
      </Block>
      <DecisionSection modStatus={app.modStatus} publishLabel="Clear" busy={busy} onDecide={onDecide} />
    </>
  );
}

export default function FlatmateReviewModal({ entry, onClose, onChanged }) {
  const { toast } = useToast();
  const kind = entryKind(entry);
  const isApp = kind === 'application';
  const [detail, setDetail] = useState({ status: isApp ? 'ready' : 'loading', data: null, error: '' });
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (isApp) return undefined;
    let alive = true;
    getFlatmateModerationDetail(entry.key)
      .then((data) => { if (alive) setDetail({ status: 'ready', data, error: '' }); })
      .catch((e) => { if (alive) setDetail({ status: 'error', data: null, error: e.message || 'Could not load this post.' }); });
    return () => { alive = false; };
  }, [entry.key, isApp, nonce]);

  // The server's refusal is shown verbatim: it names the missing field or reason.
  const run = useCallback(async (work, message, tone, close) => {
    setBusy(true);
    try {
      await work();
      toast(message, tone);
      onChanged();
      if (close) onClose(); else setNonce((n) => n + 1);
    } catch (e) {
      toast(e.message || 'That decision was refused.', 'error');
    } finally {
      setBusy(false);
    }
  }, [toast, onChanged, onClose]);

  const moderate = (current) => (next, note) => {
    const settled = next === current;
    const message = settled ? 'Re-check cleared' : next === 'approved' ? (isApp ? 'Cleared' : 'Published — it is on the board now') : `Marked ${next}`;
    const work = isApp
      ? () => moderateGroupApplication(entry.application.id, next, note)
      : () => moderateFlatmatePost(entry.key, next, note);
    return run(work, message, settled || next === 'approved' ? 'success' : 'error', true);
  };

  const [decided, setDecided] = useState(null);
  // The decided review wins over the list row: before the refetch lands, entry.review is still `pending`.
  const review = decided || detail.data?.review || (detail.data ? null : entry.review) || null;
  const decideBadge = (decision, note) => run(
    async () => setDecided(await decideFlatmateReview(review.id, decision, note)),
    decision === 'approved' ? 'Approved — the host now shows Ops-verified' : 'Rejected — the host is told why',
    decision === 'approved' ? 'success' : 'error',
    false,
  );

  const saveEdit = async (changes) => {
    if (!Object.keys(changes).length) { setEditing(false); return; }
    setBusy(true);
    try {
      setDetail({ status: 'ready', data: await editFlatmateAsModerator(entry.key, changes), error: '' });
      setEditing(false);
      toast('Details updated', 'success');
      onChanged();
    } catch (e) {
      toast(e.message || 'Could not save these changes.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const summary = entrySummary(entry);
  const d = detail.data;
  const item = d?.item;

  return (
    <Modal
      open
      onClose={onClose}
      title={isApp ? 'Review group application' : 'Review flatmate post'}
      size="lg"
      footer={(
        <>
          {d && !editing ? <button type="button" onClick={() => setEditing(true)} className="dz-btn dz-btn-ghost"><Pencil className="h-4 w-4" /> Edit details</button> : null}
          <button type="button" onClick={onClose} className="dz-btn dz-btn-ghost">Close</button>
        </>
      )}
    >
      <div className="space-y-4" data-testid="flatmate-review-modal">
        {isApp ? (
          <ApplicationBody app={entry.application} busy={busy} onDecide={moderate(entry.application.modStatus)} />
        ) : (
          <>
            <Header
              title={item?.headline || summary.title}
              kindLabel={KIND_LABEL[item?.kind || kind]}
              locality={item?.locality || summary.locality}
              price={d ? priceOf(d) : ''}
              chips={entry.reasons.map((r) => (
                <span key={r} className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300">{r}</span>
              ))}
            />
            {detail.status === 'loading' ? <Loading /> : null}
            {detail.status === 'error' ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                {detail.error}
                <button type="button" onClick={() => setNonce((n) => n + 1)} className="dz-btn dz-btn-ghost ml-3">Try again</button>
              </div>
            ) : null}
            {d && editing ? <EditDetails detail={d} busy={busy} onSave={saveEdit} onCancel={() => setEditing(false)} /> : null}
            {d && !editing ? <PostDetails detail={d} /> : null}
            {review ? <BadgeSection key={`${review.id}:${review.status}`} review={review} busy={busy || editing} onDecide={decideBadge} /> : null}
            {item ? (
              <DecisionSection
                modStatus={item.modStatus}
                recheck={item.recheckRequestedAt ? { at: item.recheckRequestedAt, reason: item.recheckReason } : null}
                busy={busy || editing}
                onDecide={moderate(item.modStatus)}
              />
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

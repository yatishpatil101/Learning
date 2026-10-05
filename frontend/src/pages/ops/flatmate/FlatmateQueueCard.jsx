import { Clock, Eye, Image as ImageIcon, MapPin, User } from 'lucide-react';
import Badge from '../../../components/ui/Badge.jsx';
import { classNames, fmtAgo } from '../../../lib/format.js';

const KIND_LABEL = { post: 'Seeker post', room: 'Room', group: 'Group', application: 'Group application' };

const WARN_REASONS = new Set(['Contested address', 'Owner consent missing', 'Edited since review', 'Live · not yet reviewed']);

export const entryKind = (e) => (e.application ? 'application' : e.post?.kind || e.review?.kind || 'post');

export function entrySummary(e) {
  if (e.application) {
    const a = e.application;
    return {
      title: a.groupTitle ? `${a.groupTitle} → ${a.listingTitle || 'a listing'}` : a.listingTitle,
      locality: a.locality,
      author: a.applicantName,
      modStatus: a.modStatus,
    };
  }
  return {
    title: e.post?.headline || e.review?.address,
    locality: e.post?.locality || null,
    author: e.post?.author || e.review?.host,
    modStatus: e.post?.modStatus || null,
  };
}

export const MOD_LABEL = { flagged: 'Hidden for review', live: 'Published', approved: 'Published' };

export default function FlatmateQueueCard({ entry, onReview }) {
  const kind = entryKind(entry);
  const s = entrySummary(entry);
  return (
    <li className="flatmate-queue-card dz-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid="flatmate-queue-card" data-key={entry.key}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
            {KIND_LABEL[kind]}
          </span>
          {s.modStatus ? <Badge status={s.modStatus}>{MOD_LABEL[s.modStatus] || null}</Badge> : null}
          {entry.reasons.map((r) => (
            <span
              key={r}
              className={classNames(
                'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                WARN_REASONS.has(r)
                  ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                  : 'border-brand-teal/30 bg-brand-teal/10 text-brand-teal',
              )}
            >
              {r}
            </span>
          ))}
        </div>
        <div className="mt-1.5 break-words font-semibold text-gray-100">{s.title || 'Untitled'}</div>
        {/* A scanning aid only; the popup renders the whole text, which is what gets reviewed. */}
        {entry.post?.snippet ? <p className="mt-0.5 line-clamp-2 break-words text-sm text-gray-400">{entry.post.snippet}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
          {s.locality ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{s.locality}</span> : null}
          <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{s.author || '—'}</span>
          {entry.since ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtAgo(entry.since)}</span> : null}
          {entry.post?.photoCount ? (
            <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" />{entry.post.photoCount} photos</span>
          ) : null}
        </div>
      </div>
      <button type="button" onClick={() => onReview(entry)} className="dz-btn dz-btn-primary shrink-0 self-start sm:self-center">
        <Eye className="h-4 w-4" />Review
      </button>
    </li>
  );
}

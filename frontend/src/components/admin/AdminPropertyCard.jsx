import { Fragment } from 'react';
import { Archive, Bell, CheckCircle, ClipboardCheck, Clock, Eye, Flag, MapPin, Pencil, RotateCcw, Star, XCircle } from 'lucide-react';
import { fmtINR, fmtNum, fmtAgo, classNames } from '../../lib/format.js';
import Badge from '../ui/Badge.jsx';
import QualityScoreBadge from '../ui/QualityScoreBadge.jsx';

const iconBtn = 'grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-gray-400 transition hover:bg-white/5 hover:text-white';

/* How long a stays-live re-check may sit before the row escalates (Q14). A listing in this queue is
   still live and still earning, so the only pressure to drain it is visual — there is no outage to
   notice. The colour is the SLA. */
const RECHECK_WARN_H = 24;
const RECHECK_BREACH_H = 72;

const recheckAgeHours = (at) => {
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? 0 : (Date.now() - t) / 3600000;
};

/** "waiting 3d" — the elapsed span, never blank, and never silently zero-length. */
const recheckWaited = (at) => {
  const ago = at ? fmtAgo(at).replace(/ ago$/, '') : '';
  return ago ? `waiting ${ago}` : 'waiting — no timestamp';
};

/* The re-check strip: which fields changed, and how long the queue has held them. Both halves are
   load-bearing — the fields are what the moderator has to go and look at, and the age is the only
   thing distinguishing a queue being worked from one nobody has opened. */
function RecheckStrip({ listing: l }) {
  const hours = recheckAgeHours(l.recheckRequestedAt);
  const breached = hours >= RECHECK_BREACH_H;
  const warn = !breached && hours >= RECHECK_WARN_H;
  return (
    <div
      data-testid="recheck-strip"
      className={classNames(
        'mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-[11px]',
        breached
          ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
          : warn
          ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
          : 'border-sky-400/30 bg-sky-500/10 text-sky-200',
      )}
    >
      <Clock className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="font-semibold">Re-check:</span>
      <span data-testid="recheck-fields">{l.recheckReason || 'unspecified fields'}</span>
      <span className="text-gray-500" aria-hidden="true">·</span>
      <span data-testid="recheck-age" className={classNames('font-semibold', breached && 'uppercase tracking-wide')}>
        {/* "waiting 3d", not "waiting 3d ago" — the elapsed span is the sentence, and fmtAgo's
            trailing "ago" turns it into a point in time. fmtAgo returns '' for an unparseable
            timestamp, which would render a bare "waiting "; fall through to the same honest
            no-timestamp wording instead. */}
        {recheckWaited(l.recheckRequestedAt)}
      </span>
      {/* The escalation must not be carried by colour alone (WCAG 1.4.1): "overdue" already gives
          the breached tier a text token, so the warn tier needs one too or it does not exist for a
          colour-blind moderator — and it is the tier where acting still prevents the breach. */}
      {warn ? <span className="font-semibold">· due soon</span> : null}
      {breached ? <span className="font-semibold">· overdue</span> : null}
    </div>
  );
}

const FURN_LABEL = { furnished: 'Furnished', semi: 'Semi-furnished', unfurnished: 'Unfurnished' };

const STAFF_STEPS = [
  { key: 'claimLinkSent', label: 'Link Sent' },
  { key: 'claimLinkOpened', label: 'Opened' },
  { key: 'aadhaarVerified', label: 'Aadhaar' },
  { key: 'photosUploaded', label: 'Photos & Docs' },
  { key: '_live', label: 'Live' },
];

const OWNER_STEPS = [
  { key: '_submitted', label: 'Submitted' },
  { key: '_inReview', label: 'In Review' },
  { key: '_clarification', label: 'Clarification' },
  { key: '_verified', label: 'Verified' },
  { key: '_live', label: 'Live' },
];

// Maps virtual step keys (prefixed '_') to resolveOwnerStepState result keys
const OWNER_KEY_MAP = { _submitted: 'submitted', _inReview: 'inReview', _clarification: 'clarification', _verified: 'verified', _live: 'live' };

function resolveOwnerStepState(listing) {
  const s = listing.status;
  if (s === 'approved') return { submitted: true, inReview: true, clarification: true, verified: true, live: true };
  if (listing.ownerVerified || listing.ownershipVerified) return { submitted: true, inReview: true, clarification: true, verified: true, live: false };
  // flagged = admin raised an issue during review; same progress as pending today,
  // kept separate so the two can diverge later (e.g. clarification step visual).
  if (listing.flagReason || s === 'flagged') return { submitted: true, inReview: true, clarification: false, verified: false, live: false };
  if (s === 'pending' || s === 'Under Review') return { submitted: true, inReview: true, clarification: false, verified: false, live: false };
  return { submitted: true, inReview: false, clarification: false, verified: false, live: false };
}

function ProgressRow({ listing: l }) {
  const steps = l.postedByAdmin ? STAFF_STEPS : OWNER_STEPS;
  const ownerState = !l.postedByAdmin ? resolveOwnerStepState(l) : null;

  const stepResults = steps.map((step) => {
    if (l.postedByAdmin) {
      return step.key === '_live' ? l.status === 'approved' : !!l[step.key];
    }
    return !!ownerState[OWNER_KEY_MAP[step.key]];
  });

  const doneCount = stepResults.filter(Boolean).length;
  const accentDone = l.postedByAdmin ? 'text-teal-300' : 'text-violet-300';
  const accentBg = l.postedByAdmin ? 'bg-teal-500 text-ink' : 'bg-violet-500 text-white';
  const accentArrow = l.postedByAdmin ? 'text-teal-500' : 'text-violet-500';

  return (
    <div className="flex items-center flex-wrap gap-y-1">
      {steps.map((step, i) => {
        const done = stepResults[i];
        const isLast = i === steps.length - 1;
        return (
          <div key={step.key} className="flex items-center">
            <div className={classNames('flex items-center gap-1 px-2 py-[3px] text-[10px] font-medium', done ? accentDone : 'text-gray-500')}>
              <span className={classNames('flex h-[14px] w-[14px] items-center justify-center rounded-full text-[8px] font-bold shrink-0', done ? accentBg : 'border border-gray-600 text-gray-600')}>
                {done ? '✓' : i + 1}
              </span>
              <span>{step.label}</span>
            </div>
            {!isLast && (
              <svg width="12" height="10" viewBox="0 0 12 10" className={classNames('shrink-0', done ? accentArrow : 'text-gray-700')}>
                <path d="M0 0 L8 0 L12 5 L8 10 L0 10 L4 5 Z" fill="currentColor" />
              </svg>
            )}
          </div>
        );
      })}
      <span className="ml-2 text-[10px] tabular-nums text-gray-500">{doneCount}/{steps.length}</span>
    </div>
  );
}

/**
 * Rich horizontal property card for admin panels — mirrors consumer list-view layout.
 * Shows image, full property details, price, and admin action buttons.
 *
 * @param {object} props
 * @param {object} props.listing - Full listing object
 * @param {object} [props.actions] - { onView, onEdit, onFeature, onFlag, onArchive, onRestore, onReview, onRecheckPass, onRecheckFail }
 * @param {boolean} [props.selectable] - show checkbox
 * @param {boolean} [props.selected] - checkbox state
 * @param {(id: string) => void} [props.onSelect] - toggle selection
 */
export default function AdminPropertyCard({ listing: l, actions = {}, selectable, selected, onSelect, showQualityScore = true }) {
  const isRent = l.deal === 'rent';
  const statusBadge = l.archived
    ? <Badge status="archived">Archived</Badge>
    : <Badge status={l.status} />;

  return (
    <div className="list-card glass rounded-2xl overflow-hidden transition hover:border-white/15">
      <div className="lr">
        {/* Image */}
        <div className="lr-img relative">
          {l.image ? (
            <img src={l.image} alt={l.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-white/5 flex items-center justify-center text-gray-600 text-xs">No image</div>
          )}
          {/* Status overlay */}
          <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
            {isRent ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-teal-600/60 text-teal-50 backdrop-blur">Rent</span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-600/60 text-emerald-50 backdrop-blur">Sale</span>
            )}
            {l.featured ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/60 text-amber-50 backdrop-blur">Featured</span>
            ) : null}
          </div>
          {/* Verification icon */}
          {(l.ownerVerified || l.ownershipVerified) ? (
            <span className="absolute bottom-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
              style={{ background: 'rgba(13,148,136,.9)' }}
              title={[l.ownerVerified && 'Verified Owner', l.ownershipVerified && 'Ownership Verified'].filter(Boolean).join(' · ')}>
              ✓
            </span>
          ) : null}
        </div>

        {/* Body */}
        <div className="lr-body">
          {/* Left: Details */}
          <div className="lr-info min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {selectable ? (
                <input type="checkbox" className="h-4 w-4 accent-brand-teal flex-shrink-0" checked={selected} onChange={() => onSelect(l.id)} />
              ) : null}
              <h3 className="text-[15px] font-bold text-white leading-snug truncate">{l.title}</h3>
              {statusBadge}
            </div>

            {/* Locality + ID */}
            <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
              <MapPin className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
              <span>{l.locality}, Pune</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-500">{l.id}</span>
            </p>

            {/* Specs row — middot-separated & tighter on mobile, spaced-out on desktop */}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-300 sm:mt-2.5 sm:gap-x-4">
              {[
                l.bhk,
                l.type,
                l.area ? `${l.area.toLocaleString('en-IN')} sq.ft` : null,
                l.furnishing && FURN_LABEL[l.furnishing] ? FURN_LABEL[l.furnishing] : null,
              ].filter(Boolean).map((spec, i) => (
                <Fragment key={i}>
                  {i > 0 ? <span className="text-gray-600 sm:hidden" aria-hidden="true">·</span> : null}
                  <span>{spec}</span>
                </Fragment>
              ))}
              {l.rera ? <span className="text-emerald-400">RERA</span> : null}
            </div>

            {/* Owner + Stats */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 sm:gap-4">
              <span>Owner: <span className="text-gray-300">{l.owner || '—'}</span></span>
              <span>{fmtNum(l.views || 0)} views</span>
              <span>{fmtNum(l.enquiries || 0)} enquiries</span>
              {l.createdAt ? <span>Posted {l.createdAt}</span> : null}
            </div>

            {/* Stays-live re-check (Q14). Rendered wherever the listing appears, not just on the
                queue tab: this listing is `approved` and looks completely ordinary otherwise, so
                without the strip a moderator on the All Listings tab has no way to tell that a
                buyer-facing facet changed since anyone last looked at it. */}
            {l.recheckPending ? <RecheckStrip listing={l} /> : null}

            {/* Progress tracker (staff-posted & owner-posted pending) */}
            {(l.status === 'pending' || l.status === 'flagged' || l.status === 'Under Review') ? (
              <div className="mt-2.5">
                <ProgressRow listing={l} />
                {l.postedByAdmin && l.reminderCount > 0 && (
                  <span className="text-[10px] text-gray-500 mt-1 inline-block">Reminded ×{l.reminderCount}</span>
                )}
              </div>
            ) : null}

            {/* Verification chips */}
            {(l.ownerVerified || l.ownershipVerified) ? (
              <div className="flex gap-1.5 mt-2">
                {l.ownerVerified ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    Verified Owner
                  </span>
                ) : null}
                {l.ownershipVerified ? (
                  <span className="inline-flex items-center rounded-full border border-indigo-400/30 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                    Ownership Verified
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Right: Price + Quality + Actions */}
          <div className="lr-aside flex-shrink-0 flex flex-col items-end justify-between">
            {/* Price + quality score — one justify-between row on mobile to
                remove wasted whitespace; stacked & right-aligned on desktop. */}
            <div className="flex w-full items-center justify-between gap-2 sm:block sm:w-auto sm:text-right">
              <div>
                <div className="text-lg font-extrabold text-white">
                  {isRent ? (
                    <>₹{(l.price || 0).toLocaleString('en-IN')}<span className="text-sm font-normal text-gray-400">/mo</span></>
                  ) : fmtINR(l.price)}
                </div>
                {l.area && !isRent ? (
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    ₹{Math.round(l.price / l.area).toLocaleString('en-IN')} / sq.ft
                  </div>
                ) : null}
              </div>
              {showQualityScore && <QualityScoreBadge listing={l} />}
            </div>

            {/* Admin actions */}
            <div className="flex items-center gap-1.5 mt-2">
              {actions.onReminder && (actions.reminderAlways || (l.postedByAdmin && l.status === 'pending')) ? (
                <button onClick={() => actions.onReminder(l)} className="pn-btn pn-btn-ghost pn-btn-sm" title="Send WhatsApp reminder to owner">
                  <Bell className="h-3.5 w-3.5" /> Remind
                </button>
              ) : null}
              {l.recheckPending && actions.onRecheckPass ? (
                <button onClick={() => actions.onRecheckPass(l)} className="pn-btn pn-btn-primary pn-btn-sm" data-testid="recheck-pass">
                  <CheckCircle className="h-3.5 w-3.5" /> Looks fine
                </button>
              ) : null}
              {l.recheckPending && actions.onRecheckFail ? (
                <button onClick={() => actions.onRecheckFail(l)} aria-label="Re-check failed — take the listing down" title="Re-check failed — take the listing down" className={classNames(iconBtn, 'hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-rose-300')} data-testid="recheck-fail">
                  <XCircle className="h-4 w-4" />
                </button>
              ) : null}
              {(l.status === 'pending' || l.status === 'Under Review') && actions.onReview ? (
                <button onClick={() => actions.onReview(l)} className="pn-btn pn-btn-primary pn-btn-sm">
                  <ClipboardCheck className="h-3.5 w-3.5" /> Review
                </button>
              ) : null}
              {actions.onView ? (
                <button onClick={() => actions.onView(l)} title="View" className={iconBtn}><Eye className="h-4 w-4" /></button>
              ) : null}
              {actions.onEdit ? (
                <button onClick={() => actions.onEdit(l)} title="Edit" className={iconBtn}><Pencil className="h-4 w-4" /></button>
              ) : null}
              {actions.onFeature ? (
                <button onClick={() => actions.onFeature(l)} title={l.featured ? 'Unfeature' : 'Feature'} className={classNames(iconBtn, l.featured && 'border-amber-400/40 bg-amber-500/20 text-amber-300')}>
                  <Star className="h-4 w-4" fill={l.featured ? 'currentColor' : 'none'} />
                </button>
              ) : null}
              {l.status === 'flagged' && actions.onClearFlag ? (
                <button onClick={() => actions.onClearFlag(l)} title="Clear flag & publish" className={classNames(iconBtn, 'border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/15')}>
                  <CheckCircle className="h-4 w-4" />
                </button>
              ) : null}
              {l.status !== 'flagged' && actions.onFlag ? (
                <button onClick={() => actions.onFlag(l)} title="Flag" className={iconBtn}><Flag className="h-4 w-4" /></button>
              ) : null}
              {l.archived && actions.onRestore ? (
                <button onClick={() => actions.onRestore(l)} title="Restore" className={iconBtn}><RotateCcw className="h-4 w-4" /></button>
              ) : (!l.archived && actions.onArchive) ? (
                <button onClick={() => actions.onArchive(l)} title="Archive" className={iconBtn}><Archive className="h-4 w-4" /></button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

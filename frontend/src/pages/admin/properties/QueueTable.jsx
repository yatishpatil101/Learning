import { Archive, Bell, CheckCircle, ClipboardCheck, Clock, Eye, Flag, MapPin, Pencil, RotateCcw, XCircle } from 'lucide-react';
import { fmtArea, fmtINR, fmtNum, isSqftUnit, classNames } from '../../../lib/format.js';
import Badge from '../../../components/ui/Badge.jsx';
import NoPhotoPlaceholder from '../../../components/ui/NoPhotoPlaceholder.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import QualityScoreBadge from '../../../components/ui/QualityScoreBadge.jsx';
import ProgressTracker from '../../../components/listing/ProgressTracker.jsx';
import { signalLabel } from './reviewReasons.js';
import { statusLabel } from './constants.js';
import { onlySeeksOwnershipBadge, seeksOwnershipBadge } from '../../../lib/recheckFields.js';
import { FURN_LBL } from '../../consumer/listings/constants.js';

const CHIP = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold';
const RED_CHIP = classNames(CHIP, 'border-rose-400/40 bg-rose-500/15 text-rose-200');
const ICON_BTN = 'grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-gray-400 transition hover:border-white/20 hover:bg-white/5 hover:text-white';
const GROUP = 'mt-2.5 border-t border-white/[0.06] pt-2.5';
const DASH = '\u2014';

/* Which clock each queue answers to. The age is the desk's whole point: a row nobody opens
   escalates by colour and by a text token, so the warning never rests on colour alone. */
const WAIT = {
  verify: { at: (l) => l.resubmittedAt || l.submittedAt, warn: 24, breach: 48, verb: 'waiting' },
  recheck: { at: (l) => l.recheckRequestedAt, warn: 24, breach: 72, verb: 'waiting' },
  badge: { at: (l) => l.ownershipRequestedAt, warn: 24, breach: 72, verb: 'waiting' },
  followup: { at: (l) => l.freshenedAt || l.submittedAt, verb: 'unconfirmed' },
};
const POSTED = { at: (l) => l.submittedAt, verb: 'posted' };

const elapsed = (hours) => (hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`);

function waitState(l, tab) {
  const rule = WAIT[tab] || POSTED;
  const at = rule.at(l);
  const t = at ? new Date(at).getTime() : NaN;
  const hours = Number.isNaN(t) ? 0 : Math.max(0, (Date.now() - t) / 3600000);
  const ago = Number.isNaN(t) ? '' : elapsed(hours);
  const tone = rule.breach && hours >= rule.breach ? 'breach' : rule.warn && hours >= rule.warn ? 'warn' : 'ok';
  return { label: ago ? `${rule.verb} ${ago}` : 'no timestamp', tone };
}

function Waiting({ listing: l, tab }) {
  const { label, tone } = waitState(l, tab);
  const ageOfRecheck = tab === 'recheck' || tab === 'badge';
  return (
    <span
      data-testid={ageOfRecheck ? 'recheck-age' : 'row-age'}
      className={classNames('inline-flex items-center gap-1 tabular-nums',
        tone === 'breach' ? 'font-semibold text-rose-300' : tone === 'warn' ? 'font-semibold text-amber-300' : '')}
    >
      <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{label}{tone === 'warn' ? ' \u00B7 due soon' : tone === 'breach' ? ' \u00B7 overdue' : ''}</span>
    </span>
  );
}

function RowChips({ listing: l, ownerReplied, hasPhoto }) {
  const soft = (l.signals?.items || []).filter((item) => item.severity !== 'hard');
  return (
    <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
      {l.postedByAdmin ? <span className={classNames(CHIP, 'border-white/10 bg-white/5 text-gray-300')}>Staff posted</span> : null}
      {!hasPhoto ? <span className={RED_CHIP}>No photos</span> : null}
      {ownerReplied ? (
        <span data-testid="owner-replied" className={classNames(CHIP, 'border-violet-400/40 bg-violet-500/15 text-violet-200')}>Owner replied</span>
      ) : l.progress?.flags?.includes('needs_info') ? (
        <span data-testid="awaiting-owner" className={classNames(CHIP, 'border-sky-400/30 bg-sky-500/10 text-sky-200')} title={'Clarification sent \u2014 waiting for the owner'}>Awaiting owner</span>
      ) : null}
      {l.progress?.flags?.includes('opened') ? <span data-testid="link-opened" className={classNames(CHIP, 'border-teal-400/30 bg-teal-500/10 text-teal-200')}>Link opened</span> : null}
      {soft.slice(0, 2).map((item) => (
        <span key={`${item.code}:${item.detail}`} className={classNames(CHIP, 'border-white/10 bg-white/5 font-medium text-gray-300')} title={item.detail || signalLabel(item.code)}>
          {signalLabel(item.code)}
        </span>
      ))}
      {soft.length > 2 ? (
        <span className="text-[10px] text-gray-500" title={soft.slice(2).map((item) => signalLabel(item.code)).join(', ')}>+{soft.length - 2}</span>
      ) : null}
      {l.recheckPending ? (
        <span data-testid="recheck-strip" className={classNames(CHIP, 'border-sky-400/30 bg-sky-500/10 text-sky-200')}>
          {onlySeeksOwnershipBadge(l) ? 'Badge request' : 'Re-check'}:&nbsp;<span data-testid="recheck-fields" className="font-medium">{l.recheckReason || 'unspecified fields'}</span>
        </span>
      ) : null}
      {l.reminderCount > 0 ? <span className="text-[10px] text-gray-500">Reminded {'\u00D7'}{l.reminderCount}</span> : null}
    </div>
  );
}

function IconAction({ label, onClick, icon: Icon, className, testId }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={classNames(ICON_BTN, className)} data-testid={testId}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

// The slot keeps its height when empty so price and icons sit at the same spot on every tile.
function PrimaryActions({ listing: l, actions }) {
  const recheck = l.recheckPending && !onlySeeksOwnershipBadge(l);
  return (
    <div className="flex min-h-9 flex-wrap items-start justify-end gap-1.5 max-md:justify-start">
      {(l.status === 'pending' || seeksOwnershipBadge(l)) && actions.onReview ? (
        <button type="button" onClick={() => actions.onReview(l)} className="dz-btn dz-btn-primary dz-btn-sm" data-testid={l.status === 'pending' ? 'review-listing' : 'review-badge-request'}>
          <ClipboardCheck className="h-3.5 w-3.5" /> Review
        </button>
      ) : null}
      {recheck && actions.onRecheckPass ? (
        <button type="button" onClick={() => actions.onRecheckPass(l)} className="dz-btn dz-btn-primary dz-btn-sm" data-testid="recheck-pass">
          <CheckCircle className="h-3.5 w-3.5" /> Looks fine
        </button>
      ) : null}
      {l.status === 'flagged' && actions.onClearFlag ? (
        <button type="button" onClick={() => actions.onClearFlag(l)} className="dz-btn dz-btn-ghost dz-btn-sm" title="Clear the flag and return the listing to review">
          <CheckCircle className="h-3.5 w-3.5" /> Clear flag
        </button>
      ) : null}
    </div>
  );
}

function IconActions({ listing: l, actions }) {
  const recheck = l.recheckPending && !onlySeeksOwnershipBadge(l);
  return (
    <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 pt-3 max-md:justify-start">
      {actions.onReminder && (actions.reminderAlways || (l.postedByAdmin && l.status === 'pending')) ? (
        <IconAction label="Remind the owner on WhatsApp" onClick={() => actions.onReminder(l)} icon={Bell} />
      ) : null}
      {recheck && actions.onRecheckFail ? (
        <IconAction label={'Re-check failed \u2014 take the listing down'} onClick={() => actions.onRecheckFail(l)} icon={XCircle} testId="recheck-fail"
          className="hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-rose-300" />
      ) : null}
      {actions.onView ? <IconAction label="View details" onClick={() => actions.onView(l)} icon={Eye} /> : null}
      {actions.onEdit ? <IconAction label="Edit" onClick={() => actions.onEdit(l)} icon={Pencil} /> : null}
      {l.status !== 'flagged' && actions.onFlag ? <IconAction label="Flag" onClick={() => actions.onFlag(l)} icon={Flag} /> : null}
      {l.archived && actions.onRestore ? (
        <IconAction label="Restore" onClick={() => actions.onRestore(l)} icon={RotateCcw} />
      ) : !l.archived && actions.onArchive ? (
        <IconAction label="Archive" onClick={() => actions.onArchive(l)} icon={Archive} className="hover:border-rose-400/40 hover:text-rose-300" />
      ) : null}
    </div>
  );
}

const rowPhoto = (l) => l.image || (Array.isArray(l.gallery) ? l.gallery.find(Boolean) : null) || l.img;

// Fixed columns so a value sits in the same place on every tile; a missing one shows a dash.
function FactRow({ label, children }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-14 shrink-0 text-[11px] text-gray-500">{label}</dt>
      <dd className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-300 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">{children}</dd>
    </div>
  );
}

const Cell = ({ children, className }) => (
  <span className={classNames('truncate', className)} title={typeof children === 'string' ? children : undefined}>{children || DASH}</span>
);

function QueueRow({ listing: l, tab, ownerReplied, actions, showScore }) {
  const photo = rowPhoto(l);
  const isRent = l.deal === 'rent';
  return (
    <li data-testid="queue-row" data-id={l.id} className="list-card glass overflow-hidden rounded-2xl transition hover:border-white/15">
      <div className="lr">
        <div className="lr-img bg-white/5">
          {photo ? <PropertyImage src={photo} alt="" loading="lazy" /> : <NoPhotoPlaceholder className="h-full w-full" label="" />}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            <span className={classNames('rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur', isRent ? 'bg-teal-600/60 text-teal-50' : 'bg-emerald-600/60 text-emerald-50')}>
              {isRent ? 'Rent' : 'Sale'}
            </span>
            {l.featured ? <span className="rounded bg-amber-500/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-50 backdrop-blur">Featured</span> : null}
          </div>
        </div>
        <div className="lr-body">
          <div className="lr-info flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="min-w-0 truncate text-[15px] font-bold leading-snug text-white" title={l.title}>{l.title}</h3>
              <span className="flex shrink-0 items-center gap-1.5">
                {l.archived ? <Badge status="archived">Archived</Badge> : <Badge status={l.status}>{statusLabel(l.status)}</Badge>}
                {l.signals?.possibleBroker ? <span className={RED_CHIP}>Possible broker</span> : null}
                {l.signals?.conflict ? <span className={RED_CHIP}>Conflict</span> : null}
              </span>
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-teal-400" aria-hidden="true" />
              <span className="shrink-0">{[l.locality, l.city || 'Pune'].filter(Boolean).join(', ')}</span>
              <span className="text-gray-600" aria-hidden="true">{'\u00B7'}</span>
              <span className="truncate text-gray-500" title={l.id}>{l.id}</span>
            </p>
            <dl className={classNames(GROUP, 'space-y-1.5')}>
              <FactRow label="Property">
                <Cell>{l.bhk}</Cell>
                <Cell>{l.type}</Cell>
                <Cell>{fmtArea(l.area, l.areaUnit)}</Cell>
                <Cell>{FURN_LBL[l.furnishing]}</Cell>
              </FactRow>
              <FactRow label="Owner">
                <Cell className="font-medium text-gray-200 md:col-span-2">{l.owner}</Cell>
                <Cell className="tabular-nums md:col-span-2">{l.ownerMobile}</Cell>
              </FactRow>
              <FactRow label="Activity">
                <Cell className="tabular-nums">{`${fmtNum(l.views || 0)} views`}</Cell>
                <Cell className="tabular-nums">{`${fmtNum(l.enquiries || 0)} enquiries`}</Cell>
                <span className="col-span-2 min-w-0 truncate"><Waiting listing={l} tab={tab} /></span>
              </FactRow>
            </dl>
            <div className={classNames(GROUP, 'space-y-2')}>
              <RowChips listing={l} ownerReplied={ownerReplied} hasPhoto={Boolean(photo)} />
              {l.progress ? <ProgressTracker progress={l.progress} compact /> : null}
            </div>
          </div>
          <div className="flex w-[212px] shrink-0 flex-col items-end border-l border-white/[0.07] pl-[18px] text-right max-md:w-full max-md:items-start max-md:border-l-0 max-md:border-t max-md:pl-0 max-md:pt-3 max-md:text-left">
            <PrimaryActions listing={l} actions={actions} />
            <div className="mt-3">
              <div className="text-lg font-extrabold tabular-nums text-white">
                {fmtINR(l.price)}{isRent ? <span className="text-sm font-normal text-gray-400">/mo</span> : null}
              </div>
              {l.area && !isRent && isSqftUnit(l.areaUnit) ? (
                <div className="mt-0.5 text-[11px] tabular-nums text-gray-500">{'\u20B9'}{Math.round(l.price / l.area).toLocaleString('en-IN')} / sq.ft</div>
              ) : null}
              {showScore ? <div className="mt-1.5 flex justify-end max-md:justify-start"><QualityScoreBadge listing={l} /></div> : null}
            </div>
            <IconActions listing={l} actions={actions} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** One page of a moderation queue: a card per listing, photo left, details centre, price and actions right. */
export default function QueueTable({ rows, tab, repliedIds, actions, empty, showScore }) {
  if (!rows.length) return <p className="p-10 text-center text-sm text-gray-400">{empty}</p>;
  return (
    <ul className="space-y-3 p-3">
      {rows.map((l) => (
        <QueueRow key={l.id} listing={l} tab={tab} ownerReplied={repliedIds.has(l.uuid || l.id)} actions={actions} showScore={showScore} />
      ))}
    </ul>
  );
}

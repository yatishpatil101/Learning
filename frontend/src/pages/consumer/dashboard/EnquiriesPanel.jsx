import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { Link, useNavigate } from 'react-router';
import { timeAgo, avatarFor } from '../../../lib/format.js';
import { myLeadNotes, saveLeadNote } from '../../../services/leadNoteService.js';
import { openFlatmateRequestConversation } from '../../../services/conversationService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { Card, SectionHead, SubNav, RequestList, RequestRow, RequestEmpty, CallBtn, WhatsAppBtn, FollowUpChip } from './components.jsx';
import LoadError from '../../../components/LoadError.jsx';
import LeadSheet from './LeadSheet.jsx';
import { buildDocGroups, listingTitleFor } from './dashboardData.js';
/* Attention-first ordering: items awaiting the owner's action float to the top of each list without reordering equal
   items (stable). */

const attentionFirst = (arr, isAttn) => [...arr].sort((a, b) => (isAttn(b) ? 1 : 0) - (isAttn(a) ? 1 : 0));
/* Per-row urgency badge for items still awaiting the owner. */

const waitPill = (requestedAt) => {
  if (!requestedAt) return null;
  const hrs = Math.floor((Date.now() - requestedAt) / 3600000);
  if (hrs >= 24) return { level: 'hot', label: `${Math.floor(hrs / 24)}d waiting` };
  if (hrs >= 1) return { level: 'hot', label: `${hrs}h waiting` };
  return { level: 'warm', label: 'new' };
};
  // Attention (any pending) first, then most-recent request.
/* A server request carries every category the buyer selected. */

function SummaryStat({ icon, tint, value, label }) {
  const chip = { teal: 'bg-brand-teal/15 text-brand-teal', sky: 'bg-sky-400/15 text-sky-300', amber: 'bg-amber-400/15 text-amber-300' }[tint] || '';
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className={'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ' + chip}>
        <Icon name={icon} className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none text-white">{value}</p>
        {/* 11px is below the mobile secondary-text floor; desktop keeps the tighter size. */}
        <p className="mt-1 text-[13px] sm:text-[11px] leading-tight text-gray-500">{label}</p>
      </div>
    </div>
  );
}

export default function EnquiriesPanel({ contactReqs, decideContact, photoReqs = [], decidePhotoReq, flatmateReqs = [], decideFlatmateReq, apps = [], decideApp, docReqs = [], decideDocReqs, listings = [], isBusy = () => false, contactReqsFailed = false, contactReqsError, onRetryContactReqs, photoReqsFailed = false, photoReqsError, onRetryPhotoReqs, docReqsFailed = false, docReqsError, onRetryDocReqs, flatmateReqsFailed = false, flatmateReqsError, onRetryFlatmateReqs, appsFailed = false, appsError, onRetryApps }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  /* Leads inbox split into sub-tabs — number, photo, document and flatmate requests — each one a real request a real
     person made. */
  const navigate = useNavigate();
  const { flagEnabled } = useAppFlags();

  // Resolve a listing id to its human title for request meta lines.
  const titleOf = (id) => listingTitleFor(listings, id, id || '');
  const docGroups = buildDocGroups(docReqs, titleOf);
  const pendingDocGroups = docGroups.filter((g) => g.pendingIds.length > 0);

  const pendingContacts = contactReqs.filter((r) => r.status === 'pending');
  const pendingFlatmateReqs = flatmateReqs.filter((r) => r.status === 'pending');
  const pendingApps = apps.filter((r) => r.status === 'pending');
  // Filtered to pending, or the attention badge would keep counting photo requests the owner has
  // already marked done — which is how a badge stops being read at all.
  const pendingPhotoReqs = photoReqs.filter((r) => (r.status || 'pending') === 'pending');
  const waitingItems = [...pendingContacts, ...pendingFlatmateReqs, ...pendingApps, ...pendingPhotoReqs, ...pendingDocGroups];
  const waitingOnYou = waitingItems.length;
  const anyReqFailed = contactReqsFailed || photoReqsFailed || docReqsFailed || flatmateReqsFailed || appsFailed;
  // Age of the oldest thing awaiting a reply — powers the urgency chip + nudge.

  const oldestAt = waitingItems.reduce((min, r) => {
    const t = r.requestedAt || r.at || 0;
    return t && t < min ? t : min;
  }, Infinity);
  const waitHrs = oldestAt < Infinity ? Math.max(0, Math.floor((Date.now() - oldestAt) / 3600000)) : 0;
  const waitLabel = waitingOnYou === 0 ? '—' : waitHrs < 1 ? '<1h' : waitHrs < 24 ? `${waitHrs}h` : `${Math.floor(waitHrs / 24)}d`;

  const items = [
    { key: 'all', label: 'All leads', icon: 'inbox', count: waitingOnYou },
    { key: 'numbers', label: 'Number requests', icon: 'lock-keyhole', count: pendingContacts.length },
    { key: 'photos', label: 'Photo requests', icon: 'image', count: pendingPhotoReqs.length },
    { key: 'documents', label: 'Documents', icon: 'folder-check', count: pendingDocGroups.length },
    { key: 'flatmate', label: 'Flatmate', icon: 'users', count: pendingFlatmateReqs.length + pendingApps.length },
  ];
  // "All leads" defaults to one priority-sorted inbox so owners are not forced to tab-hop; the type
  // tabs remain as focused filters.

  const [sub, setSub] = useState('all');

  const btnGhost = 'px-3 min-h-[44px] rounded-lg bg-white/5 text-gray-300 text-xs font-semibold hover:bg-white/10 flex items-center gap-1';
  const btnTeal = 'px-3 min-h-[44px] rounded-lg bg-brand-teal/15 text-brand-teal text-xs font-semibold hover:bg-brand-teal/25 flex items-center gap-1';

  const openFlatmateChat = async (requestId) => {
    try {
      const conv = await openFlatmateRequestConversation(requestId);
      navigate(`/messages?c=${encodeURIComponent(conv.id)}`);
    } catch (e) {
      toast(e?.message || 'Could not open the chat. Please try again.', 'error');
    }
  };

  const orderedContacts = attentionFirst(contactReqs, (r) => r.status === 'pending');
  const orderedFlatmateReqs = attentionFirst(flatmateReqs, (r) => r.status === 'pending');
  // Flatmate request kinds → icon/tint/label, shared by the filter tab and the
  // unified queue so a room/group/flatmate request reads the same in both.

  const flatMeta = (r) => ({
    icon: r.kind === 'room' ? 'bed-double' : r.kind === 'group' ? 'users' : 'hand-heart',
    tint: r.kind === 'room' ? 'sky' : r.kind === 'group' ? 'violet' : 'teal',
    label: r.kind === 'room' ? 'Room enquiry' : r.kind === 'group' ? (r.action === 'join' ? 'Group join' : 'Group request') : 'Flatmate interest',
  });

  /* Normalize each request type into one lead descriptor. */
  const statusLabel = (status) => ({
    pending: 'Waiting on you',
    approved: 'Accepted',
    accepted: 'Accepted',
    resolved: 'Done',
    granted: 'Granted',
    declined: 'Declined',
    expired: 'Expired',
  }[String(status || 'pending').toLowerCase()] || 'Declined');

  const disabledFor = (key) => isBusy?.(key) || false;

  const itemNumber = (r) => ({
    id: 'number:' + r.id, type: 'number', typeLabel: 'Number request', typeIcon: 'lock-keyhole',
    name: r.buyerName, contactMobile: r.status === 'approved' ? r.buyerMobile : undefined,
    verified: !!r.verified,
    propLabel: r.propId ? titleOf(r.propId) : '',
    detail: 'Wants to contact you', requestedAt: r.requestedAt, status: r.status,
    attention: r.status === 'pending', canApprove: true,
    approve: () => decideContact(r.id, 'approved'), decline: () => decideContact(r.id, 'declined'),
    approveLabel: 'Accept', declineLabel: 'Decline',
    busyKey: 'contact:' + r.id,
  /* Two exits, not one: leaving a photo request pending reads as "not yet" to both sides, so the owner's inbox
     accumulates rows they can never clear and the buyer waits on photos that are not coming. */
  });
  const itemPhoto = (r) => {
    const pending = (r.status || 'pending') === 'pending';
    return {
      id: 'photo:' + r.id, type: 'photo', typeLabel: 'Photo request', typeIcon: 'image',
      name: r.buyerName, propLabel: r.propLabel || '',
      detail: 'Wants more photos of your listing', requestedAt: r.requestedAt, status: r.status || 'pending',
      attention: pending, canApprove: pending && !!decidePhotoReq,
      approve: () => decidePhotoReq(r.id, 'resolved'), approveLabel: 'Mark done',
      decline: () => decidePhotoReq(r.id, 'declined'), declineLabel: 'Decline',
      primaryAction: r.propId ? { to: `/list-property?edit=${r.propId}&step=photos`, label: 'Add photos', icon: 'image' } : null,
      busyKey: 'photo:' + r.id,
    };
  };
  const itemDoc = (g) => {
    const types = g.pendingDocTypes?.length ? g.pendingDocTypes : g.docTypes;
    const n = types.length;
    const preview = types.slice(0, 3).join(', ') + (n > 3 ? ` +${n - 3} more` : '');
    const pending = g.pendingIds.length > 0;
    return {
      id: 'documents:' + g.key, type: 'documents', typeLabel: 'Document request', typeIcon: 'folder-check',
      name: g.buyerName, propLabel: g.propLabel || '',
      detail: `Wants ${n} document${n === 1 ? '' : 's'}: ${preview}`,
      requestedAt: g.requestedAt === Infinity ? null : g.requestedAt,
      status: pending ? 'pending' : (g.grantedIds.length ? 'granted' : 'declined'),
      attention: pending, canApprove: pending,
      approve: () => decideDocReqs(g.pendingIds, 'granted'), decline: () => decideDocReqs(g.pendingIds, 'declined'),
      approveLabel: 'Grant all', declineLabel: 'Decline all',
      busyKey: 'doc:' + g.pendingIds[0],
      legacyKey: g.legacyKey,
    };
  };
  const itemFlat = (r) => {
    const m = flatMeta(r);
    return {
      id: 'flatmate:' + r.id, type: 'flatmate', typeLabel: m.label, typeIcon: m.icon, tint: m.tint,
      name: r.requesterName, propLabel: r.targetTitle || '',
      detail: r.locality || '', requestedAt: r.requestedAt, status: r.status,
      attention: r.status === 'pending', canApprove: true,
      approve: () => decideFlatmateReq(r.id, 'accepted'), decline: () => decideFlatmateReq(r.id, 'declined'),
      approveLabel: 'Accept', declineLabel: 'Decline',
      busyKey: 'flatmate:' + r.id,
    };
  };
  const itemApp = (r) => ({
    id: 'app:' + r.id, type: 'app', typeLabel: 'Group application', typeIcon: 'users-round',
    name: r.groupTitle || 'Flatmate group', propLabel: r.listingTitle || '',
    detail: `${r.members}/${r.seatsTotal} members`, requestedAt: r.at, status: r.status,
    attention: r.status === 'pending', canApprove: true,
    approve: () => decideApp?.(r.id, 'accepted'), decline: () => decideApp?.(r.id, 'declined'),
    approveLabel: 'Accept', declineLabel: 'Decline',
    busyKey: 'app:' + r.id,
  });
  // Unified queue: attention (awaiting you) first; within each band the longest-
  // waiting lead leads; items without a timestamp sink to the bottom.

  const leadItems = [
    ...contactReqs.map(itemNumber),
    ...photoReqs.map(itemPhoto),
    ...docGroups.map(itemDoc),
    ...flatmateReqs.map(itemFlat),
    ...apps.map(itemApp),
  ].sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    return (a.requestedAt || Infinity) - (b.requestedAt || Infinity);
  });
  /* The badge is the server's word and only the server's, with no phone-keyed fallback lookup. */

  const badgeFor = (item) => (item?.verified ? t('verify.seriousBuyer') : undefined);
  /* Reshaped to a `{ [leadKey]: annotation }` map here, not in the providers, so both keep the server's own array
     shape while rows get one lookup each. */

  const [annos, setAnnos] = useState({});
  const [sheetLead, setSheetLead] = useState(null);

  useEffect(() => {
    let live = true;
    myLeadNotes()
      .then((rows) => {
        if (!live) return;
        setAnnos(Object.fromEntries(rows.map((r) => [r.leadKey, r])));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  /* The sheet sends a partial patch but the endpoint takes the whole annotation — JSON cannot tell an omitted field
     from one cleared to null, so a partial write could never clear a date. */

  const saveAnno = async (patch) => {
    if (!sheetLead) return;
    const key = sheetLead.id;
    const base = annos[key] || (sheetLead.legacyKey ? annos[sheetLead.legacyKey] : null) || {};
    const merged = { note: null, followUpAt: null, ...base, ...patch };
    try {
      const saved = await saveLeadNote(key, { note: merged.note, followUpAt: merged.followUpAt });
      setAnnos((prev) => {
        const next = { ...prev };
        if (saved) next[key] = saved;
        else delete next[key];
        return next;
      });
      /* A silently dropped note is worse than a visible failure: the owner walks away believing they have written
         something down. */
    } catch {
      toast('That note did not save. Please try again.', 'error');
    }
  };

  return (
      /* Lead triage strip — turns a passive inbox into a conversion cockpit. */
    <div className="space-y-6">
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-3 gap-3">
          <SummaryStat icon="bell" tint="teal" value={anyReqFailed ? '—' : waitingOnYou} label="Waiting on you" />
          <SummaryStat icon="inbox" tint="sky" value={anyReqFailed ? '—' : leadItems.length} label="Open leads" />
          <SummaryStat icon="timer" tint="amber" value={waitLabel} label="Oldest waiting" />
        </div>
        {!anyReqFailed && waitingOnYou === 0 && leadItems.length > 0 ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-300">
            <Icon name="check-circle" className="h-4 w-4 flex-shrink-0" />
            You're all caught up — every lead has a response.
          </p>
        ) : null}
      </Card>

      <div className="dz-docks-under-nav sticky top-[var(--dz-nav-h)] z-20 -mx-4 bg-ink/95 px-4 pt-1 backdrop-blur">
        <SubNav items={items} active={sub} onChange={setSub} variant="underline" />
      </div>
      {/* Unified priority queue — every lead type in one list, longest-waiting first */}

      {sub === 'all' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="inbox" title="All leads" sub="Every request in one place, highest-priority first. Tap a lead for its details, a private note and a follow-up date." />
        {anyReqFailed ? (
          <LoadError
            message="We couldn't load every request."
            error={contactReqsError || photoReqsError || docReqsError || flatmateReqsError || appsError}
            onRetry={() => {
              if (contactReqsFailed) onRetryContactReqs?.();
              if (photoReqsFailed) onRetryPhotoReqs?.();
              if (docReqsFailed) onRetryDocReqs?.();
              if (flatmateReqsFailed) onRetryFlatmateReqs?.();
              if (appsFailed) onRetryApps?.();
            }}
            className="rounded-2xl p-5"
          />
        ) : leadItems.length === 0 ? (
          <RequestEmpty icon="inbox" text="No leads yet." cta={{ to: '/list-property', label: 'Post a listing to get leads', icon: 'plus-circle' }} />
        ) : (
          <RequestList>
            {leadItems.map((item) => (
              <RequestRow
                key={item.id}
                avatar={avatarFor(item.name)}
                title={item.name}
                badge={badgeFor(item)}
                meta={`${item.typeLabel}${item.propLabel ? ' · ' + item.propLabel : ''}`}
                time={item.requestedAt ? timeAgo(item.requestedAt) : undefined}
                urgency={item.attention ? waitPill(item.requestedAt) : undefined}
                attention={item.attention}
                onOpen={() => setSheetLead(item)}
              >
                {/* The primary link comes first and independently of the decision buttons. */}
                <FollowUpChip ts={annos[item.id]?.followUpAt} />
                {item.primaryAction ? (
                  <Link to={item.primaryAction.to} className={btnTeal}><Icon name={item.primaryAction.icon} className="w-3.5 h-3.5" /> {item.primaryAction.label}</Link>
                ) : null}
                {item.canApprove && item.status === 'pending' ? (
                  <>
                    <button disabled={disabledFor(item.busyKey)} onClick={item.approve} className={item.primaryAction ? btnGhost : btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> {item.approveLabel}</button>
                    {item.decline ? (
                      <button disabled={disabledFor(item.busyKey)} onClick={item.decline} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> {item.declineLabel}</button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className={'inline-flex items-center gap-1 text-xs font-medium ' + (['approved', 'accepted', 'resolved', 'granted'].includes(item.status) ? 'text-emerald-300' : 'text-gray-400')}>{statusLabel(item.status)}</span>
                    {item.contactMobile ? (
                      <>
                        <CallBtn mobile={item.contactMobile} name={item.name} />
                        <WhatsAppBtn mobile={item.contactMobile} name={item.name} />
                      </>
                    ) : null}
                  </>
                )}
              </RequestRow>
            ))}
          </RequestList>
        )}
      </Card>
      )}
      {/* Owner number requests */}

      {sub === 'numbers' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="lock-keyhole" title="Contact requests" sub="Buyers who want to contact you. Accept to start the chat and see their number." />
        {contactReqsFailed ? (
          <LoadError message={t('dash.contactReqsLoadError')} error={contactReqsError} onRetry={onRetryContactReqs} className="rounded-2xl p-5" />
        ) : contactReqs.length === 0 ? (
          <RequestEmpty icon="lock-keyhole" text="No number requests yet." cta={{ to: '/list-property', label: 'Post a listing to get leads', icon: 'plus-circle' }} />
        ) : (
          <RequestList>
            {orderedContacts.map((r) => (
              <RequestRow
                key={r.id}
                avatar={avatarFor(r.buyerName)}
                title={r.buyerName}
                badge={r.verified ? t('verify.seriousBuyer') : undefined}
                meta={`Wants to contact you${r.propId ? ' · ' + titleOf(r.propId) : ''}`}
                time={timeAgo(r.requestedAt)}
                urgency={r.status === 'pending' ? waitPill(r.requestedAt) : undefined}
                attention={r.status === 'pending'}
                onOpen={() => setSheetLead(itemNumber(r))}
              >
                {r.status === 'pending' ? (
                  <>
                    <button disabled={disabledFor('contact:' + r.id)} onClick={() => decideContact(r.id, 'approved')} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> Accept</button>
                    <button disabled={disabledFor('contact:' + r.id)} onClick={() => decideContact(r.id, 'declined')} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> Decline</button>
                  </>
                ) : r.status === 'approved' ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300 font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> {statusLabel(r.status)}</span>
                    <CallBtn mobile={r.buyerMobile} name={r.buyerName} />
                    <WhatsAppBtn mobile={r.buyerMobile} name={r.buyerName} />
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-medium"><Icon name="x-circle" className="w-3.5 h-3.5" /> {statusLabel(r.status)}</span>
                )}
              </RequestRow>
            ))}
          </RequestList>
        )}
      </Card>
      )}
      {/* Photo requests */}

      {sub === 'photos' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="image" title="Photo requests" sub="Buyers who asked for more photos of your listings. Adding photos converts these into visits." />
        {photoReqsFailed ? (
          <LoadError message={t('dash.photoReqsLoadError')} error={photoReqsError} onRetry={onRetryPhotoReqs} className="rounded-2xl p-5" />
        ) : photoReqs.length === 0 ? (
          <RequestEmpty icon="image" text="No photo requests yet." cta={{ to: '/list-property', label: 'Add photos to your listings', icon: 'image' }} />
        ) : (
          <RequestList>
            {photoReqs.map((r) => {
              const pending = (r.status || 'pending') === 'pending';
              return (
                <RequestRow
                  key={r.id}
                  icon="image"
                  tint="teal"
                  title={r.buyerName}
                  meta={`Wants more photos${r.propLabel ? ' · ' + r.propLabel : ''}`}
                  time={timeAgo(r.requestedAt)}
                  urgency={pending ? waitPill(r.requestedAt) : undefined}
                  attention={pending}
                  onOpen={() => setSheetLead(itemPhoto(r))}
                >
                    {/* `step=photos` because the ask is photos, not an edit: without it the owner lands on page one
                       of three and walks past every answer already given. */}
                  {r.propId ? (
                    <Link to={`/list-property?edit=${r.propId}&step=photos`} className={btnTeal}><Icon name="image" className="w-3.5 h-3.5" /> Add photos</Link>
                  ) : null}
                  {/* Uploading photos and marking done are separate owner acts. */}
                  {pending ? (
                    <>
                      <button type="button" disabled={disabledFor('photo:' + r.id)} onClick={() => decidePhotoReq(r.id, 'resolved')} className={btnGhost}>
                        <Icon name="check" className="w-3.5 h-3.5" /> Mark done
                      </button>
                      <button type="button" disabled={disabledFor('photo:' + r.id)} onClick={() => decidePhotoReq(r.id, 'declined')} className={btnGhost}>
                        <Icon name="x" className="w-3.5 h-3.5" /> Decline
                      </button>
                    </>
                    /* Which answer went out, not just that one did. */
                  ) : (
                    <span className="text-xs font-semibold text-gray-500">
                      {statusLabel(r.status)}
                    </span>
                  )}
                </RequestRow>
              );
            })}
          </RequestList>
        )}
      </Card>
      )}
      {/* Document requests — buyers asking to view the owner's property papers during due diligence. */}

      {sub === 'documents' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="folder-check" title="Document requests" sub="Buyers asking to view your property papers. They stay view-only — you approve which documents each buyer can see." />
        {docReqsFailed ? (
          <LoadError message={t('dash.reqsLoadError')} error={docReqsError} onRetry={onRetryDocReqs} className="rounded-2xl p-5" />
        ) : docGroups.length === 0 ? (
          <RequestEmpty icon="folder-check" text="No document requests yet." cta={{ to: '/list-property', label: 'Post a listing to get leads', icon: 'plus-circle' }} />
        ) : (
          <RequestList>
            {docGroups.map((g) => {
              const types = g.pendingDocTypes?.length ? g.pendingDocTypes : g.docTypes;
              const n = types.length;
              const preview = types.slice(0, 3).join(', ') + (n > 3 ? ` +${n - 3} more` : '');
              const pending = g.pendingIds.length > 0;
              return (
                <RequestRow
                  key={g.key}
                  avatar={avatarFor(g.buyerName)}
                  title={g.buyerName}
                  meta={`Wants ${n} document${n === 1 ? '' : 's'}: ${preview}${g.propLabel ? ' · ' + g.propLabel : ''}`}
                  time={timeAgo(g.requestedAt)}
                  urgency={pending ? waitPill(g.requestedAt) : undefined}
                  attention={pending}
                  onOpen={() => setSheetLead(itemDoc(g))}
                >
                  {pending ? (
                    <>
                      <button disabled={g.pendingIds.some((id) => disabledFor('doc:' + id))} onClick={() => decideDocReqs(g.pendingIds, 'granted')} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> Grant all</button>
                      <button disabled={g.pendingIds.some((id) => disabledFor('doc:' + id))} onClick={() => decideDocReqs(g.pendingIds, 'declined')} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> Decline all</button>
                    </>
                  ) : g.grantedIds.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300 font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> {g.grantedCategoryCount === n ? 'All granted' : `Granted ${g.grantedCategoryCount} of ${n}`}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-medium"><Icon name="x-circle" className="w-3.5 h-3.5" /> Declined</span>
                  )}
                </RequestRow>
              );
            })}
          </RequestList>
        )}
      </Card>
      )}
      {/* Flatmate requests — seekers who reached out on your flatmates posts */}

      {sub === 'flatmate' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="users" title="Flatmate requests" sub="Seekers interested in your flatmate posts, rooms, and groups. Accept to connect in Messages." />
        {/* A load failure cannot support a "no flatmate requests yet" claim. */}
        {flatmateReqsFailed || appsFailed ? (
          <LoadError
            message="We couldn't load your flatmate requests."
            error={flatmateReqsError || appsError}
            onRetry={() => { onRetryFlatmateReqs?.(); onRetryApps?.(); }}
            className="rounded-2xl p-5"
          />
        ) : flatmateReqs.length === 0 && apps.length === 0 ? (
          <RequestEmpty icon="users" text="No flatmate requests yet." cta={{ to: '/list-property?flatmate=1', label: 'List a room or flatmate', icon: 'plus-circle' }} />
        ) : (
          <RequestList>
            {orderedFlatmateReqs.map((r) => {
              const kindIcon = r.kind === 'room' ? 'bed-double' : r.kind === 'group' ? 'users' : 'hand-heart';
              const kindTint = r.kind === 'room' ? 'sky' : r.kind === 'group' ? 'violet' : 'teal';
              const kindLabel = r.kind === 'room' ? 'Room enquiry' : r.kind === 'group' ? (r.action === 'join' ? 'Group join' : 'Group request') : 'Flatmate interest';
              return (
                <RequestRow
                  key={r.id}
                  icon={kindIcon}
                  tint={kindTint}
                  title={r.requesterName}
                  meta={`${kindLabel} · ${r.targetTitle}${r.locality ? ' · ' + r.locality : ''}`}
                  time={timeAgo(r.requestedAt)}
                  urgency={r.status === 'pending' ? waitPill(r.requestedAt) : undefined}
                  attention={r.status === 'pending'}
                  onOpen={() => setSheetLead(itemFlat(r))}
                >
                  {r.status === 'pending' ? (
                    <>
                      <button disabled={disabledFor('flatmate:' + r.id)} onClick={() => decideFlatmateReq(r.id, 'accepted')} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> Accept</button>
                      <button disabled={disabledFor('flatmate:' + r.id)} onClick={() => decideFlatmateReq(r.id, 'declined')} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> Decline</button>
                    </>
                  ) : r.status === 'accepted' ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-300 font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> Accepted</span>
                      {flagEnabled('inAppMessaging') && <button onClick={() => openFlatmateChat(r.id)} data-testid="flatmate-req-chat" className={btnTeal}><Icon name="message-circle" className="w-3.5 h-3.5" /> Message</button>}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-medium"><Icon name="x-circle" className="w-3.5 h-3.5" /> Declined</span>
                  )}
                </RequestRow>
              );
            })}
            {apps.map((r) => {
              const item = itemApp(r);
              return (
                <RequestRow
                  key={item.id}
                  icon="users-round"
                  tint="violet"
                  title={item.name}
                  meta={`Group application${item.propLabel ? ' · ' + item.propLabel : ''}`}
                  time={item.requestedAt ? timeAgo(item.requestedAt) : undefined}
                  urgency={item.attention ? waitPill(item.requestedAt) : undefined}
                  attention={item.attention}
                  onOpen={() => setSheetLead(item)}
                >
                  {r.status === 'pending' ? (
                    <>
                      <button disabled={disabledFor('app:' + r.id)} onClick={() => decideApp?.(r.id, 'accepted')} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> Accept</button>
                      <button disabled={disabledFor('app:' + r.id)} onClick={() => decideApp?.(r.id, 'declined')} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> Decline</button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-medium"><Icon name={r.status === 'accepted' ? 'badge-check' : 'x-circle'} className="w-3.5 h-3.5" /> {statusLabel(r.status)}</span>
                  )}
                </RequestRow>
              );
            })}
          </RequestList>
        )}
      </Card>
      )}

      {sheetLead ? (
        <LeadSheet
          key={sheetLead.id}
          lead={sheetLead}
          annotation={annos[sheetLead.id] || (sheetLead.legacyKey ? annos[sheetLead.legacyKey] : null) || null}
          onClose={() => setSheetLead(null)}
          onSaveAnnotation={saveAnno}
          busy={disabledFor(sheetLead.busyKey)}
        />
      ) : null}
    </div>
  );
}

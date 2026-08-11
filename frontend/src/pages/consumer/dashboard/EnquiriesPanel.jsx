import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { Link } from 'react-router';
import { timeAgo, avatarFor } from '../../../lib/format.js';
import { myMobile } from '../../../lib/contact.js';
import { tenantsVerified } from '../../../services/rentService.js';
import { getLeadAnnotations, setLeadAnnotation } from '../../../lib/leadNotes.js';
import { Card, SectionHead, StatusBadge, SubNav, RequestList, RequestRow, RequestEmpty, CallBtn, WhatsAppBtn, FollowUpChip } from './components.jsx';
import LoadError from '../../../components/LoadError.jsx';
import LeadSheet from './LeadSheet.jsx';

/* Attention-first ordering: items awaiting the owner's action float to the top of
   each list without reordering equal items (stable). */
const attentionFirst = (arr, isAttn) => [...arr].sort((a, b) => (isAttn(b) ? 1 : 0) - (isAttn(a) ? 1 : 0));

/* Last ten digits, or `''`. A masked number (`98XXXXX210`) yields five and is therefore dropped —
   the key the badge is looked up under is the same shape the seam normalises to. */
const tenDigits = (mobile) => {
  const d = String(mobile || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '';
};

/* Per-row urgency badge for items still awaiting the owner. The app's own promise is
   "reply within an hour", so anything past 1h reads as `hot` (rose), fresh items as a
   quiet `warm` "new" — making the most-at-risk lead instantly recognizable in a scan. */
const waitPill = (requestedAt) => {
  if (!requestedAt) return null;
  const hrs = Math.floor((Date.now() - requestedAt) / 3600000);
  if (hrs >= 24) return { level: 'hot', label: `${Math.floor(hrs / 24)}d waiting` };
  if (hrs >= 1) return { level: 'hot', label: `${hrs}h waiting` };
  return { level: 'warm', label: 'new' };
};

/* A buyer requesting documents creates one record per document (addDocRequest loops
   over the doc set). For the triage inbox we collapse those into one lead per
   buyer+property, so a single due-diligence request reads as a single row and the
   "Waiting on you" count stays honest. Grant/Decline then act on every pending
   document in the group at once. */
function groupDocReqs(reqs, titleOf) {
  const map = new Map();
  for (const r of reqs) {
    const key = (r.buyerMobile || '') + '|' + (r.propId || '');
    let g = map.get(key);
    if (!g) {
      g = { key, buyerName: r.buyerName || 'A buyer', buyerMobile: r.buyerMobile || '', propId: r.propId || '', propLabel: titleOf(r.propId), docTypes: [], pendingIds: [], grantedIds: [], declinedIds: [], requestedAt: Infinity };
      map.set(key, g);
    }
    if (r.docType) g.docTypes.push(r.docType);
    if (r.status === 'pending') g.pendingIds.push(r.id);
    else if (r.status === 'granted') g.grantedIds.push(r.id);
    else if (r.status === 'declined') g.declinedIds.push(r.id);
    const t = r.requestedAt || 0;
    if (t && t < g.requestedAt) g.requestedAt = t;
  }
  // Attention (any pending) first, then most-recent request.
  return [...map.values()].sort((a, b) => {
    const ap = a.pendingIds.length ? 1 : 0, bp = b.pendingIds.length ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.requestedAt || 0) - (a.requestedAt || 0);
  });
}

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

export default function EnquiriesPanel({ contactReqs, decideContact, enquiries, photoReqs = [], flatmateReqs = [], decideFlatmateReq, docReqs = [], decideDocReqs, listings = [], contactReqsFailed = false, contactReqsError, onRetryContactReqs, docReqsFailed = false, docReqsError, onRetryDocReqs }) {
  const { t } = useTranslation();
  /* Leads inbox, split into sub-tabs so each lead type gets its own focused view:
     Number requests, Photo requests, Documents, Flatmate, and general Enquiries.
     Rows share one borderless "quiet list" treatment (RequestList/RequestRow) so
     every tab reads as the same system. A summary strip on top turns the inbox into
     a triage tool — showing what's waiting, how many leads are open, and a fast-reply
     nudge. (Site visits live in their own Scheduled Visits tab, not here.) */

  // Resolve a listing id to its human title for request meta lines.
  const titleOf = (id) => listings.find((l) => l.id === id)?.title || id || '';
  const docGroups = groupDocReqs(docReqs, titleOf);
  const pendingDocGroups = docGroups.filter((g) => g.pendingIds.length > 0);

  // Attention math — what needs a decision now vs. total open leads.
  const pendingContacts = contactReqs.filter((r) => r.status === 'pending');
  const pendingFlatmateReqs = flatmateReqs.filter((r) => r.status === 'pending');
  const waitingItems = [...pendingContacts, ...pendingFlatmateReqs, ...photoReqs, ...pendingDocGroups];
  const waitingOnYou = waitingItems.length;
  const totalLeads = contactReqs.length + photoReqs.length + flatmateReqs.length + docGroups.length + enquiries.length;

  // Age of the oldest thing awaiting a reply — powers the urgency chip + nudge.
  const oldestAt = waitingItems.reduce((min, r) => {
    const t = r.requestedAt || 0;
    return t && t < min ? t : min;
  }, Infinity);
  const waitHrs = oldestAt < Infinity ? Math.max(0, Math.floor((Date.now() - oldestAt) / 3600000)) : 0;
  const waitLabel = waitingOnYou === 0 ? '—' : waitHrs < 1 ? '<1h' : waitHrs < 24 ? `${waitHrs}h` : `${Math.floor(waitHrs / 24)}d`;

  const items = [
    { key: 'all', label: 'All leads', icon: 'inbox', count: waitingOnYou },
    { key: 'numbers', label: 'Number requests', icon: 'lock-keyhole', count: pendingContacts.length },
    { key: 'photos', label: 'Photo requests', icon: 'image', count: photoReqs.length },
    { key: 'documents', label: 'Documents', icon: 'folder-check', count: pendingDocGroups.length },
    { key: 'flatmate', label: 'Flatmate', icon: 'users', count: pendingFlatmateReqs.length },
    { key: 'enquiries', label: 'Enquiries', icon: 'messages-square', count: enquiries.length },
  ];

  // The unified "All leads" queue is the default view — one priority-sorted inbox
  // instead of forcing owners to tab-hop. The type tabs remain as focused filters.
  const [sub, setSub] = useState('all');

  const btnGhost = 'px-3 min-h-[44px] rounded-lg bg-white/5 text-gray-300 text-xs font-semibold hover:bg-white/10 flex items-center gap-1';
  const btnTeal = 'px-3 min-h-[44px] rounded-lg bg-brand-teal/15 text-brand-teal text-xs font-semibold hover:bg-brand-teal/25 flex items-center gap-1';

  const orderedContacts = attentionFirst(contactReqs, (r) => r.status === 'pending');
  const orderedFlatmateReqs = attentionFirst(flatmateReqs, (r) => r.status === 'pending');

  // Flatmate request kinds → icon/tint/label, shared by the filter tab and the
  // unified queue so a room/group/flatmate request reads the same in both.
  const flatMeta = (r) => ({
    icon: r.kind === 'room' ? 'bed-double' : r.kind === 'group' ? 'users' : 'hand-heart',
    tint: r.kind === 'room' ? 'sky' : r.kind === 'group' ? 'violet' : 'teal',
    label: r.kind === 'room' ? 'Room enquiry' : r.kind === 'group' ? (r.action === 'join' ? 'Group join' : 'Group request') : 'Flatmate interest',
  });

  /* Normalize each request type into one lead descriptor. The same shape powers the
     unified "All leads" list, the tappable row → detail sheet, and the sheet's
     actions — so a lead behaves identically everywhere. `id` is stable per lead so
     private notes/follow-ups (leadNotes) stay attached across re-renders. */
  const itemNumber = (r) => ({
    id: 'number:' + r.id, type: 'number', typeLabel: 'Number request', typeIcon: 'lock-keyhole',
    name: r.buyerName, contactMobile: r.status === 'approved' ? r.buyerMobile : undefined,
    verified: !!r.verified,
    propLabel: r.propId ? titleOf(r.propId) : '',
    detail: 'Requested your phone number', requestedAt: r.requestedAt, status: r.status,
    attention: r.status === 'pending', canApprove: true,
    approve: () => decideContact(r.id, 'approved'), decline: () => decideContact(r.id, 'declined'),
    approveLabel: 'Share', declineLabel: 'Decline',
  });
  const itemPhoto = (r) => ({
    id: 'photo:' + r.id, type: 'photo', typeLabel: 'Photo request', typeIcon: 'image',
    name: r.buyerName, propLabel: r.propLabel || '',
    detail: 'Wants more photos of your listing', requestedAt: r.requestedAt, status: 'pending',
    attention: true, canApprove: false,
    primaryAction: r.propId ? { to: `/list-property?edit=${r.propId}`, label: 'Add photos', icon: 'image' } : null,
  });
  const itemDoc = (g) => {
    const n = g.docTypes.length;
    const preview = g.docTypes.slice(0, 3).join(', ') + (n > 3 ? ` +${n - 3} more` : '');
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
    };
  };
  const itemEnquiry = (e) => ({
    id: 'enquiry:' + e.id, type: 'enquiry', typeLabel: 'Enquiry', typeIcon: 'messages-square',
    name: e.customer, contactMobile: e.mobile, propLabel: e.listing || '',
    detail: '', requestedAt: null, status: e.status, attention: false, canApprove: false,
  });

  // Unified queue: attention (awaiting you) first; within each band the longest-
  // waiting lead leads; items without a timestamp sink to the bottom.
  const leadItems = [
    ...contactReqs.map(itemNumber),
    ...photoReqs.map(itemPhoto),
    ...docGroups.map(itemDoc),
    ...flatmateReqs.map(itemFlat),
    ...enquiries.map(itemEnquiry),
  ].sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    return (a.requestedAt || Infinity) - (b.requestedAt || Infinity);
  });

    /* Generic enquiries still only carry a phone number, so their badge remains a batch lookup.
      Owner contact requests no longer do: the server states `requester.verified` on each row, which
      is the bit D185 exists to surface on the *pending* rows where the mobile is still masked.

     `tenantsVerified` fails closed by construction: an unknown number, a still-masked one, a
     signed-out caller or a rejected request all produce *absence*, and absence renders no badge. A
     verified buyer may lose their tick; an unverified one can never gain one, which is the only
     direction this is allowed to be wrong in.

     Keyed on the sorted, de-duplicated digit list rather than the array, so the request fires when
     the *people* change and not on every re-render of a list rebuilt each pass. */
    const badgeKey = [...new Set(enquiries.map((e) => tenDigits(e.mobile)).filter(Boolean))].sort().join(',');
  const [verifiedBuyers, setVerifiedBuyers] = useState(() => new Set());
  useEffect(() => {
    if (!badgeKey) { setVerifiedBuyers(new Set()); return undefined; }
    let live = true;
    tenantsVerified(badgeKey.split(','))
      .then((set) => { if (live) setVerifiedBuyers(set); })
      .catch(() => { if (live) setVerifiedBuyers(new Set()); });
    return () => { live = false; };
  }, [badgeKey]);
  const isVerifiedBuyer = (mobile) => {
    const d = tenDigits(mobile);
    return !!d && verifiedBuyers.has(d);
  };
  const badgeFor = (item) => (item?.verified ? t('verify.seriousBuyer') : (isVerifiedBuyer(item?.contactMobile) ? t('verify.seriousBuyer') : undefined));

  // Lead detail sheet + owner-private annotations (notes / follow-up dates).
  const owner = myMobile();
  const [annos, setAnnos] = useState(() => getLeadAnnotations(owner));
  const [sheetLead, setSheetLead] = useState(null);
  const saveAnno = (patch) => {
    if (!sheetLead) return;
    setLeadAnnotation(owner, sheetLead.id, patch);
    setAnnos(getLeadAnnotations(owner));
  };

  return (
    <div className="space-y-6">
      {/* Lead triage strip — turns a passive inbox into a conversion cockpit. */}
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-3 gap-3">
          <SummaryStat icon="bell" tint="teal" value={waitingOnYou} label="Waiting on you" />
          <SummaryStat icon="inbox" tint="sky" value={totalLeads} label="Open leads" />
          <SummaryStat icon="timer" tint="amber" value={waitLabel} label="Oldest waiting" />
        </div>
        {waitingOnYou > 0 ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-brand-teal/10 px-3 py-2.5 text-xs font-medium text-brand-teal">
            <Icon name="zap" className="h-4 w-4 flex-shrink-0" />
            Fast replies win — respond within an hour to book up to 3× more visits.
          </p>
        ) : totalLeads > 0 ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-300">
            <Icon name="check-circle" className="h-4 w-4 flex-shrink-0" />
            You're all caught up — every lead has a response.
          </p>
        ) : null}
      </Card>

      <div className="pn-docks-under-nav sticky top-[var(--pn-nav-h)] z-20 -mx-4 bg-ink/95 px-4 pt-1 backdrop-blur">
        <SubNav items={items} active={sub} onChange={setSub} variant="underline" />
      </div>

      {/* Unified priority queue — every lead type in one list, longest-waiting first */}
      {sub === 'all' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="inbox" title="All leads" sub="Every request in one place, highest-priority first. Tap a lead for its details, a private note and a follow-up date." />
        {leadItems.length === 0 ? (
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
                <FollowUpChip ts={annos[item.id]?.followUpAt} />
                {item.canApprove && item.status === 'pending' ? (
                  <>
                    <button onClick={item.approve} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> {item.approveLabel}</button>
                    <button onClick={item.decline} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> {item.declineLabel}</button>
                  </>
                ) : item.primaryAction ? (
                  <Link to={item.primaryAction.to} className={btnTeal}><Icon name={item.primaryAction.icon} className="w-3.5 h-3.5" /> {item.primaryAction.label}</Link>
                ) : item.contactMobile ? (
                  <>
                    <CallBtn mobile={item.contactMobile} name={item.name} />
                    <WhatsAppBtn mobile={item.contactMobile} name={item.name} />
                  </>
                ) : null}
              </RequestRow>
            ))}
          </RequestList>
        )}
      </Card>
      )}

      {/* Owner number requests */}
      {sub === 'numbers' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="lock-keyhole" title="Owner number requests" sub="Buyers asking for your phone number. Your number stays hidden until you approve." />
        {contactReqsFailed ? (
          /* "No number requests yet" is a claim about buyer demand, and an owner acts on it — by
             dropping their price, or by concluding the listing is dead. We are not entitled to
             make it from a request that failed (D166). */
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
                meta={`Requested your number${r.propId ? ' · ' + titleOf(r.propId) : ''}`}
                time={timeAgo(r.requestedAt)}
                urgency={r.status === 'pending' ? waitPill(r.requestedAt) : undefined}
                attention={r.status === 'pending'}
                onOpen={() => setSheetLead(itemNumber(r))}
              >
                {r.status === 'pending' ? (
                  <>
                    <button onClick={() => decideContact(r.id, 'approved')} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> Share</button>
                    <button onClick={() => decideContact(r.id, 'declined')} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> Decline</button>
                  </>
                ) : r.status === 'approved' ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300 font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> Shared</span>
                    <CallBtn mobile={r.buyerMobile} name={r.buyerName} />
                    <WhatsAppBtn mobile={r.buyerMobile} name={r.buyerName} />
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-medium"><Icon name="x-circle" className="w-3.5 h-3.5" /> Declined</span>
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
        {photoReqs.length === 0 ? (
          <RequestEmpty icon="image" text="No photo requests yet." cta={{ to: '/list-property', label: 'Add photos to your listings', icon: 'image' }} />
        ) : (
          <RequestList>
            {photoReqs.map((r) => (
              <RequestRow
                key={r.id}
                icon="image"
                tint="teal"
                title={r.buyerName}
                meta={`Wants more photos${r.propLabel ? ' · ' + r.propLabel : ''}`}
                time={timeAgo(r.requestedAt)}
                urgency={waitPill(r.requestedAt)}
                attention
                onOpen={() => setSheetLead(itemPhoto(r))}
              >
                {r.propId ? (
                  <Link to={`/list-property?edit=${r.propId}`} className={btnTeal}><Icon name="image" className="w-3.5 h-3.5" /> Add photos</Link>
                ) : null}
              </RequestRow>
            ))}
          </RequestList>
        )}
      </Card>
      )}

      {/* Document requests — buyers asking to view the owner's property papers during
          due diligence. Grouped per buyer+property so one request reads as one lead. */}
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
              const n = g.docTypes.length;
              const preview = g.docTypes.slice(0, 3).join(', ') + (n > 3 ? ` +${n - 3} more` : '');
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
                      <button onClick={() => decideDocReqs(g.pendingIds, 'granted')} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> Grant all</button>
                      <button onClick={() => decideDocReqs(g.pendingIds, 'declined')} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> Decline all</button>
                    </>
                  ) : g.grantedIds.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300 font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> {g.grantedIds.length === n ? 'All granted' : `Granted ${g.grantedIds.length} of ${n}`}</span>
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
        {flatmateReqs.length === 0 ? (
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
                      <button onClick={() => decideFlatmateReq(r.id, 'accepted')} className={btnTeal}><Icon name="check" className="w-3.5 h-3.5" /> Accept</button>
                      <button onClick={() => decideFlatmateReq(r.id, 'declined')} className={btnGhost}><Icon name="x" className="w-3.5 h-3.5" /> Decline</button>
                    </>
                  ) : r.status === 'accepted' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300 font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> Accepted</span>
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

      {/* General Enquiries */}
      {sub === 'enquiries' && (
      <Card className="p-4 sm:p-6">
        <SectionHead icon="messages-square" title="Enquiries" sub="People interested in your listings." />
        {enquiries.length === 0 ? (
          <RequestEmpty icon="messages-square" text="No enquiries yet." cta={{ to: '/list-property', label: 'Post a listing to get enquiries', icon: 'plus-circle' }} />
        ) : (
          <RequestList>
            {enquiries.map((e) => (
              <RequestRow
                key={e.id}
                avatar={avatarFor(e.customer)}
                title={e.customer}
                badge={isVerifiedBuyer(e.mobile) ? t('verify.seriousBuyer') : undefined}
                meta={`${e.listing} · ${e.mobile}`}
                onOpen={() => setSheetLead(itemEnquiry(e))}
              >
                <StatusBadge status={e.status} />
                <CallBtn mobile={e.mobile} name={e.customer} />
                <WhatsAppBtn mobile={e.mobile} name={e.customer} />
              </RequestRow>
            ))}
          </RequestList>
        )}
      </Card>
      )}

      {sheetLead ? (
        <LeadSheet
          key={sheetLead.id}
          lead={sheetLead}
          annotation={annos[sheetLead.id] || null}
          onClose={() => setSheetLead(null)}
          onSaveAnnotation={saveAnno}
        />
      ) : null}
    </div>
  );
}

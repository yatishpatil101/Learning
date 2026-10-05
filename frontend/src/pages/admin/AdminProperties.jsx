import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download } from 'lucide-react';
import { searchForModeration, getProperty, setListingStatus, clearFlag, flagListing, updateListingAsModerator, archiveListing, restoreListing, listDuplicateClusters, moderationSummary } from '../../services/propertyService.js';
import { chaseOwner } from '../../services/outreachService.js';
import { startPropertyReview, decidePropertyReview, listPropertyReviewQueue } from '../../services/propertyReviewService.js';
import { saveNoteIfAny } from '../../components/ui/InternalNote.jsx';
import { fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { freshnessState } from '../../lib/freshness.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPermission } from '../../lib/adminModules.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import Loading from '../../components/ui/Loading.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import QueueTable from './properties/QueueTable.jsx';
import QueueFilterBar, { PageNav, EMPTY_FILTERS, ALL_TAB_DEFAULTS } from './properties/QueueFilterBar.jsx';
import DuplicatesTab from './properties/DuplicatesTab.jsx';
import PropertyReviewModal from './properties/PropertyReviewModal.jsx';
import { PropertyEditModal, PropertyFlagModal, PropertyArchiveModal, PropertyViewModal, PropertyRecheckRejectModal } from './properties/PropertyModals.jsx';
import { statusQuery, PAGE_LIMIT, exportCsv } from './properties/constants.js';

// The verification routes bind `{id}` as a UUID while `propertyMapper` sets `id` to `slug || id`,
// so only the review calls need the real key off `uuid`.
const pid = (listing) => listing?.uuid || listing?.id;

const TABS = [
  { key: 'verify', label: 'To verify', count: (s) => s?.pending, note: 'Open only: new and resubmitted listings with no decision yet, including ones waiting on the owner. A listing leaves once you approve or reject it. Oldest first.' },
  { key: 'recheck', label: 'Re-checks', count: (s) => s?.recheck, note: 'Open only: live listings whose owner changed price, furnishing or possession. They stay in search until you check them, and leave this tab once you pass or take them down.' },
  { key: 'badge', label: 'Badge requests', count: (s) => s?.badgeRequests, note: 'Open only: owners asking for the Verified badge. Check the vault documents in the review; a request leaves once you grant or decline it.' },
  { key: 'followup', label: 'Follow-up', count: (s) => s?.unconfirmed, note: 'Open only: live listings not confirmed as available in over 30 days. Send a WhatsApp nudge; a listing leaves once the owner confirms.' },
  { key: 'flagged', label: 'Flagged', count: (s) => s?.flagged, note: 'Open only: listings taken out of search. A listing leaves once you clear the flag (back to review) or archive it.' },
  { key: 'duplicates', label: 'Duplicates', count: (s, dup) => dup },
  { key: 'all', label: 'All listings', count: (s) => s?.total, note: 'Every listing, open or closed. Filter by status to find approved, not approved or archived ones.' },
];
const TAB_KEYS = TABS.map((t) => t.key);

const CSV_NAMES = { verify: 'verification-queue', recheck: 'recheck-queue', badge: 'badge-requests', followup: 'follow-up', flagged: 'flagged', all: 'listings' };

const SORT_COLUMN = { recheck: 'recheck', badge: 'badge', followup: 'confirmed' };
const sortFor = (tab, dir) => (SORT_COLUMN[tab] ? `${SORT_COLUMN[tab]}-${dir}` : dir);

function queueFilters(tab, f) {
  const common = { q: f.q.trim() || undefined, deal: f.deal || undefined };
  switch (tab) {
    case 'verify': return { ...common, status: 'pending', archived: false, progress: f.progress || undefined };
    case 'recheck': return { ...common, recheck: true, archived: false };
    case 'badge': return { ...common, badge: true, archived: false };
    // Never predicate this on `real` — the mapper does not emit that field, and doing so hid fifty-three listings.
    case 'followup': return { ...common, status: 'approved', archived: false, unconfirmed: true };
    case 'flagged': return { ...common, status: 'flagged', archived: false };
    default: return {
      ...common,
      ...statusQuery(f.status),
      postedByAdmin: f.source === 'staff' ? true : f.source === 'owner' ? false : undefined,
      featured: f.featured || undefined,
    };
  }
}

// `null`, `failed` and `[]` stay distinct, and `stale` makes rows inert until they answer `key`.
function useModerationQueue(enabled, filters, sort, page, reloadToken) {
  const key = JSON.stringify([filters, sort, page]);
  const [state, setState] = useState({ page: null, failed: false, key: null });
  const debounced = Boolean(filters.q);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const [f, s, p] = JSON.parse(key);
    const run = () => {
      searchForModeration(f, s, { page: p, size: PAGE_LIMIT })
        .then((res) => { if (alive) setState({ page: res, failed: false, key }); })
        .catch((err) => {
          console.error('[AdminProperties] moderation queue failed', key, err);
          if (alive) setState({ page: null, failed: true, key });
        });
    };
    const t = setTimeout(run, debounced ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [enabled, key, reloadToken, debounced]);
  return useMemo(
    // Not stale before the first answer: `page` is null there, so the loading gate shows instead.
    () => ({ page: state.page, failed: state.failed, stale: state.key != null && state.key !== key }),
    [state, key],
  );
}

// `pointer-events-none` is the load-bearing part: rows answering a superseded query still carry
// Approve/Reject/Remind, and acting on one would reach the wrong owner.
function QueueBody({ stale, children }) {
  return (
    <div aria-busy={stale || undefined} className={stale ? 'pointer-events-none select-none opacity-50' : undefined} data-testid={stale ? 'queue-updating' : undefined}>
      {children}
    </div>
  );
}

// The wording is the point: "nothing here" after a 500 would tell the desk the backlog is clear.
function QueueFailed({ noun }) {
  return (
    <p className="p-10 text-center text-sm text-gray-400" data-testid="queue-error">
      Could not load the {noun} queue. This is a failed request, not an empty queue — retry before acting on it.
    </p>
  );
}

/* A deep link may carry the uuid (review inbox) or the slug (analytics): the desk search matches the
   uuid, so a slug is resolved through the public read first. */
async function findForReview(id) {
  const match = (rows) => rows.find((l) => l.id === id || l.uuid === id);
  const hit = match((await searchForModeration({ q: id }, 'newest', { size: 5 })).items);
  if (hit) return hit;
  const found = await getProperty(id).catch(() => null);
  if (!found?.uuid) return null;
  return match((await searchForModeration({ q: found.uuid }, 'newest', { size: 5 })).items) || found;
}

export default function AdminProperties() {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useTabParam(TAB_KEYS, 'verify');

  const canVerify = hasPermission(user, 'properties:verify');
  const canModerate = hasPermission(user, 'properties:moderate');
  const verifyOnly = canVerify && !canModerate;
  const activeTab = tab;

  const [filters, setFilters] = useState(() => (activeTab === 'all' ? ALL_TAB_DEFAULTS : EMPTY_FILTERS));
  // Reset during render, not in an effect: the tab also changes from outside (palette, back button).
  const [filtersTab, setFiltersTab] = useState(activeTab);
  if (filtersTab !== activeTab) {
    setFiltersTab(activeTab);
    setFilters(activeTab === 'all' ? ALL_TAB_DEFAULTS : EMPTY_FILTERS);
  }
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  const setPage = useCallback((n) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (n > 1) next.set('page', String(n)); else next.delete('page');
    return next;
  }, { replace: true }), [setParams]);

  const defaults = activeTab === 'all' ? ALL_TAB_DEFAULTS : EMPTY_FILTERS;
  const filtered = Object.keys(defaults).some((k) => filters[k] !== defaults[k]);
  const changeFilters = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const clearFilters = () => changeFilters(defaults);

  const [review, setReview] = useState(null);
  const [edit, setEdit] = useState(null);
  const [flagFor, setFlagFor] = useState(null);
  const [flagReason, setFlagReason] = useState('');
  const [archiveFor, setArchiveFor] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [view, setView] = useState(null);
  const [recheckRejectFor, setRecheckRejectFor] = useState(null);
  const [recheckRejectReasonCode, setRecheckRejectReasonCode] = useState('');
  const [recheckRejectReasonNote, setRecheckRejectReasonNote] = useState('');
  const [internalNote, setInternalNote] = useState('');

  // The database counting the whole catalogue. `null` on failure, so a tab count is omitted rather
  // than reading "0" — an all-clear nobody issued.
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(() => moderationSummary()
    .then(setSummary)
    .catch((err) => {
      console.error('[AdminProperties] moderation summary unavailable', err);
      setSummary(null);
    }), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const [reloadToken, setReloadToken] = useState(0);
  const refresh = () => loadSummary().finally(() => setReloadToken((n) => n + 1));

  // Without a tick a desk left open never escalates a row to overdue.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAgeTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const [dupCount, setDupCount] = useState(null);
  useEffect(() => {
    let live = true;
    listDuplicateClusters()
      .then((res) => { if (live) setDupCount(res.clusters.length); })
      .catch((err) => {
        console.error('[AdminProperties] duplicate count unavailable', err);
        if (live) setDupCount(null);
      });
    return () => { live = false; };
  }, [reloadToken]);

  // ponytail: first 100 unread cases only; page through if the desk ever holds more.
  const [repliedIds, setRepliedIds] = useState(() => new Set());
  useEffect(() => {
    let live = true;
    listPropertyReviewQueue({ unread: true, size: 100 })
      .then((res) => { if (live) setRepliedIds(new Set(res.items.map((r) => r.propertyId))); })
      .catch((err) => console.error('[AdminProperties] owner-replied set unavailable', err));
    return () => { live = false; };
  }, [reloadToken]);

  const isQueueTab = activeTab !== 'duplicates';
  const query = useMemo(() => queueFilters(activeTab, filters), [activeTab, filters]);
  const sort = sortFor(activeTab, filters.sort);
  const queue = useModerationQueue(isQueueTab, query, sort, page, reloadToken);
  const rows = useMemo(() => queue.page?.items || [], [queue.page]);
  const total = queue.page?.total ?? 0;
  const pageCount = queue.page?.pageCount ?? 0;

  // A decision can empty the last page; step back rather than showing "nothing here" over a backlog.
  useEffect(() => {
    if (queue.page && !queue.stale && rows.length === 0 && page > 1 && pageCount > 0) setPage(pageCount);
  }, [queue.page, queue.stale, rows.length, page, pageCount, setPage]);

  const findListing = useCallback((id) => rows.find((l) => l.id === id) || (review?.id === id ? review : undefined), [rows, review]);

  const openReview = (l) => {
    setReview(l);
    // Opening the case marks the owner's replies read server-side.
    setRepliedIds((ids) => { const next = new Set(ids); next.delete(l.uuid || l.id); return next; });
  };

  // Keyed by id, not a boolean: the bell links here with a new ?review= while the page is mounted.
  const handledReviewId = useRef(null);
  const reviewParam = params.get('review');
  useEffect(() => {
    if (!reviewParam || handledReviewId.current === reviewParam) return undefined;
    let live = true;
    findForReview(reviewParam)
      .then((l) => {
        if (!live) return;
        handledReviewId.current = reviewParam;
        if (l) openReview(l);
        else toast(`No listing ${reviewParam} — it may have been archived`, 'error');
      })
      .catch((err) => { if (live) toast(`Could not open listing ${reviewParam}: ${err.message}`, 'error'); });
    return () => { live = false; };
    // `openReview` only sets state; listing it would re-run the lookup on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewParam, toast]);

  const doClearFlag = async (l) => {
    if (!window.confirm(`Clear the flag on "${l.title}"?`)) return;
    try {
      await clearFlag(l.id);
    } catch (err) {
      toast(`Could not clear the flag: ${err.message}`, 'error');
      return;
    }
    // Clearing withdraws the complaint, it does not verify: the server returns the row to `pending`.
    toast('Flag cleared — back in the review queue', 'success');
    refresh();
  };
  // `PropertyModerationService` clears the re-check on any `setStatus`, so re-approving is "checked it, all fine".
  const doRecheckPass = async (l) => {
    if (!window.confirm(`Re-check "${l.title}" — confirm ${l.recheckReason || 'the edited fields'} look fine?`)) return;
    try {
      await setListingStatus(l.id, 'approved', { expectedStatus: l.status });
    } catch (err) {
      toast(`Could not clear the re-check: ${err.message}`, 'error');
      return;
    }
    toast('Re-check cleared — listing stays live', 'success');
    refresh();
  };
  const openRecheckReject = (l) => { setRecheckRejectFor(l); setRecheckRejectReasonCode(''); setRecheckRejectReasonNote(''); };
  const submitRecheckReject = async () => {
    const code = recheckRejectReasonCode;
    const note = recheckRejectReasonNote.trim();
    if (!code) { toast('Choose a reason code before rejecting', 'error'); return; }
    if (code === 'other' && !note) { toast('Add a note for Other', 'error'); return; }
    const l = findListing(recheckRejectFor.id) || recheckRejectFor;
    // One call writes the case file, the status and the owner's reason together; start first because deciding 404s.
    try {
      await startPropertyReview(pid(l));
      await decidePropertyReview(pid(l), 'reject', { reasonCode: code, note: note || undefined, expectedStatus: l.status });
    } catch (err) {
      toast(`Could not reject: ${err.message}`, 'error');
      return;
    }
    setRecheckRejectFor(null);
    setRecheckRejectReasonCode('');
    setRecheckRejectReasonNote('');
    toast('Listing rejected and removed from search', 'success');
    refresh();
  };

  const doArchive = (l) => { setArchiveFor(l); setArchiveReason(''); setInternalNote(''); };
  const submitArchive = async () => {
    try {
      await archiveListing(archiveFor.id, archiveReason.trim() || undefined);
    } catch (err) {
      toast(`Could not archive: ${err.message}`, 'error');
      return;
    }
    const noted = await saveNoteIfAny('listing', archiveFor.id, internalNote, 'Archived');
    setArchiveFor(null);
    toast(noted.error ? 'Listing archived \u2014 but the internal note could not be saved' : 'Listing archived', noted.error ? 'error' : undefined);
    refresh();
  };
  const doRestore = async (l) => {
    if (!window.confirm(`Restore "${l.title}"?`)) return;
    try {
      await restoreListing(l.id);
    } catch (err) {
      toast(`Could not restore: ${err.message}`, 'error');
      return;
    }
    toast('Listing restored — moved to pending review', 'success');
    refresh();
  };
  const openFlag = (l) => { setFlagFor(l); setFlagReason(''); setInternalNote(''); };
  const submitFlag = async () => {
    const r = flagReason.trim();
    if (!r) { toast('Add a reason before flagging', 'error'); return; }
    try {
      await flagListing(flagFor.id, r);
    } catch (err) {
      toast(`Could not flag: ${err.message}`, 'error');
      return;
    }
    const noted = await saveNoteIfAny('listing', flagFor.id, internalNote, 'Flagged');
    setFlagFor(null);
    toast(noted.error ? 'Listing flagged \u2014 but the internal note could not be saved' : 'Listing flagged', noted.error ? 'error' : undefined);
    refresh();
  };
  // `bhkNum`, not the rendered `bhk`: the label is "3 BHK", and the contract wants an integer.
  const openEdit = (l) => { setEdit({ id: l.id, title: l.title || '', price: l.price ?? '', area: l.area ?? '', bhk: l.bhkNum ? String(l.bhkNum) : '', type: l.type || '', locality: l.locality || '', deal: l.deal || 'buy', status: l.status || 'pending', _ref: l }); };
  // Two calls: `ListingUpdate` deliberately omits `status` so a PATCH cannot self-escalate.
  const submitEdit = async () => {
    const title = edit.title.trim();
    const price = +edit.price;
    const area = edit.area === '' ? '' : +edit.area;
    const loc = edit.locality.trim();
    if (!title) return toast('Title is required', 'error');
    if (Number.isNaN(price) || price <= 0) return toast('Enter a valid price', 'error');
    if (area !== '' && (Number.isNaN(area) || area < 0)) return toast('Area must be a positive number', 'error');
    if (!loc) return toast('Locality is required', 'error');
    const bhkRaw = String(edit.bhk ?? '').trim();
    const bhkNum = bhkRaw === '' ? undefined : Number(bhkRaw);
    if (bhkNum !== undefined && (!Number.isInteger(bhkNum) || bhkNum < 0)) {
      return toast('Configuration must be a whole number of bedrooms', 'error');
    }
    if (edit._ref.status === 'rejected' && edit.status !== edit._ref.status) {
      return toast('Use Request reopen in the review panel to reverse a final rejection', 'error');
    }
    const ref = edit._ref || {};
    const nextPatch = Object.fromEntries(Object.entries({
      title: title !== (ref.title || '') ? title : undefined,
      price: price !== Number(ref.price) ? price : undefined,
      area: area !== '' && area !== Number(ref.area) ? area : undefined,
      bhk: bhkNum !== undefined && bhkNum !== ref.bhkNum ? bhkNum : undefined,
      type: edit.type.trim() !== (ref.type || '') ? edit.type.trim() : undefined,
      locality: loc !== (ref.locality || '') ? loc : undefined,
      deal: edit.deal !== (ref.deal || 'buy') ? edit.deal : undefined,
    }).filter(([, value]) => value !== undefined));
    try {
      // The moderator route: `/me/listings/{id}` is owner-scoped and 404s for anyone else's listing.
      if (Object.keys(nextPatch).length) await updateListingAsModerator(edit.id, nextPatch);
      if (edit.status && edit.status !== edit._ref.status) await setListingStatus(edit.id, edit.status, { expectedStatus: edit._ref.status });
    } catch (err) {
      toast(`Could not save: ${err.message}`, 'error');
      return;
    }
    setEdit(null);
    toast('Listing updated', 'success');
    refresh();
  };

  /* The tab is opened synchronously inside the click and navigated only once the server accepts:
     opening it after the await loses it to popup blockers, and before would promise an unrecorded send. */
  const chase = async (l, templateId) => {
    const handoff = window.open('', '_blank');
    try {
      const prepared = await chaseOwner(l.uuid || l.id, templateId);
      if (handoff) handoff.location = prepared.handoffLink;
      toast(`Chaser written for ${l.owner || 'the owner'} \u2014 finish sending it in WhatsApp`, 'success');
      refresh();
    } catch (err) {
      if (handoff) handoff.close();
      toast(err?.message || 'Could not write this chaser', 'error');
    }
  };
  const handleReminder = (l) => chase(l, 'wa-gentle');
  const handleConfirmReminder = (l) => chase(l, freshnessState(l) === 'dormant' ? 'wa-dormant' : 'wa-stale');

  // The export reaches past the ten on screen: it asks the server for the first hundred matches.
  const exportCurrentCsv = async () => {
    try {
      const res = await searchForModeration(query, sort, { page: 1, size: 100 });
      if (res.total > res.items.length) toast(`Exported the first ${res.items.length} of ${res.total} — filter to narrow it down`);
      exportCsv(`draazy-${CSV_NAMES[activeTab] || 'listings'}.csv`,
        ['ID', 'Title', 'BHK', 'Type', 'Locality', 'Price', 'Deal', 'Status', 'Owner', 'Mobile', 'Submitted', 'Re-check fields', 'Re-check queued at', 'Featured'],
        res.items.map((l) => [l.id, l.title, l.bhk, l.type, l.locality, l.price, l.deal, l.status, l.owner, l.ownerMobile, l.createdAt, l.recheckReason || '', l.recheckRequestedAt || '', l.featured ? 'Yes' : 'No']));
    } catch (err) {
      toast(`Could not export: ${err.message}`, 'error');
    }
  };

  const moderateActions = canModerate ? {
    onEdit: openEdit,
    onReminder: handleReminder,
    onConfirmReminder: handleConfirmReminder,
    onFlag: openFlag,
    onArchive: doArchive,
    onClearFlag: doClearFlag,
    onRestore: doRestore,
    onRecheckPass: doRecheckPass,
    onRecheckFail: openRecheckReject,
  } : {};
  const actionsFor = {
    verify: { onView: setView, onEdit: moderateActions.onEdit, onReview: canVerify ? openReview : null, onReminder: moderateActions.onReminder, onFlag: moderateActions.onFlag, onArchive: moderateActions.onArchive },
    recheck: { onView: setView, onEdit: moderateActions.onEdit, onReview: canVerify ? openReview : null, onRecheckPass: moderateActions.onRecheckPass, onRecheckFail: moderateActions.onRecheckFail, onFlag: moderateActions.onFlag, onArchive: moderateActions.onArchive },
    badge: { onView: setView, onEdit: moderateActions.onEdit, onReview: canVerify ? openReview : null, onFlag: moderateActions.onFlag, onArchive: moderateActions.onArchive },
    followup: { onView: setView, onEdit: moderateActions.onEdit, onReminder: moderateActions.onConfirmReminder, reminderAlways: true, onFlag: moderateActions.onFlag, onArchive: moderateActions.onArchive },
    flagged: { onView: setView, onEdit: moderateActions.onEdit, onClearFlag: moderateActions.onClearFlag, onArchive: moderateActions.onArchive },
    all: { onView: setView, onEdit: moderateActions.onEdit, onFlag: moderateActions.onFlag, onClearFlag: moderateActions.onClearFlag, onArchive: moderateActions.onArchive, onRestore: moderateActions.onRestore, onReview: canVerify ? openReview : null, onReminder: moderateActions.onReminder, onRecheckPass: moderateActions.onRecheckPass, onRecheckFail: moderateActions.onRecheckFail },
  };

  const activeMeta = TABS.find((t) => t.key === activeTab);
  const paging = { page, pageCount, total, size: PAGE_LIMIT, onPage: setPage, stale: queue.stale };

  return (
    <div className="pb-20">
      <PageHeader
        title="Properties"
        subtitle={verifyOnly ? 'Review, verify and approve every listing before it goes live' : 'Manage, verify and curate every listing'}
        actions={optionEnabled('properties.csvExport') && isQueueTab ? <button type="button" onClick={exportCurrentCsv} className="dz-btn dz-btn-ghost"><Download className="h-4 w-4" /> Export CSV</button> : null}
      />

      <HScroll role="tablist" aria-label="Queues" wrapClassName="mb-4" fadeColor="var(--brand-dark)" className="flex gap-1 border-b border-white/10">
        {TABS.map((t) => {
          const n = t.count(summary, dupCount);
          const on = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`queue-tab-${t.key}`}
              aria-controls="queue-panel"
              data-tab={t.key}
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={classNames(
                '-mb-px flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                on ? 'border-brand-teal text-white' : 'border-transparent text-gray-400 hover:text-white',
              )}
            >
              {t.label}
              {n != null ? (
                <span data-testid={`tab-count-${t.key}`} className={classNames('rounded-full px-1.5 py-px text-[11px] tabular-nums', on ? 'bg-brand-teal/20 text-teal-200' : n ? 'bg-white/10 text-gray-200' : 'bg-white/5 text-gray-500')}>
                  {fmtNum(n)}
                </span>
              ) : null}
            </button>
          );
        })}
      </HScroll>

      {activeTab === 'duplicates' ? <DuplicatesTab onRefresh={refresh} canModerate={canModerate} /> : (
        <section id="queue-panel" role="tabpanel" aria-labelledby={`queue-tab-${activeTab}`} className="dz-card overflow-hidden p-0">
          {activeMeta?.note ? (
            <p className="border-b border-white/10 px-4 py-2.5 text-xs text-gray-400" data-testid={`${activeTab}-note`}>{activeMeta.note}</p>
          ) : null}
          <QueueFilterBar tab={activeTab} filters={filters} onChange={changeFilters} onClear={clearFilters} paging={paging} />
          <QueueBody stale={queue.stale}>
            {queue.failed && !queue.stale ? <QueueFailed noun={activeMeta?.label.toLowerCase()} /> : queue.page == null ? <Loading /> : (
              <QueueTable
                rows={rows}
                tab={activeTab}
                repliedIds={repliedIds}
                actions={actionsFor[activeTab]}
                showScore={optionEnabled('properties.qualityScore')}
                empty={filtered ? 'No listings match these filters.' : 'All caught up — nothing waiting here.'}
              />
            )}
          </QueueBody>
          {pageCount > 1 ? (
            <div className="flex justify-end border-t border-white/10 p-3"><PageNav {...paging} /></div>
          ) : null}
        </section>
      )}

      {review && <PropertyReviewModal review={review} setReview={setReview} onRefresh={refresh} />}
      <PropertyEditModal edit={edit} setEdit={setEdit} onSubmit={submitEdit} />
      <PropertyFlagModal flagFor={flagFor} setFlagFor={setFlagFor} flagReason={flagReason} setFlagReason={setFlagReason} internalNote={internalNote} setInternalNote={setInternalNote} onSubmit={submitFlag} />
      <PropertyArchiveModal archiveFor={archiveFor} setArchiveFor={setArchiveFor} archiveReason={archiveReason} setArchiveReason={setArchiveReason} internalNote={internalNote} setInternalNote={setInternalNote} onSubmit={submitArchive} />
      <PropertyViewModal view={view} setView={setView} />
      <PropertyRecheckRejectModal target={recheckRejectFor} setTarget={setRecheckRejectFor} reasonCode={recheckRejectReasonCode} setReasonCode={setRecheckRejectReasonCode} note={recheckRejectReasonNote} setNote={setRecheckRejectReasonNote} onSubmit={submitRecheckReject} />
    </div>
  );
}

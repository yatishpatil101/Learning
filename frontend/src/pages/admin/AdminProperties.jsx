import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Archive, ArrowUpRight, Building2, Check, CheckCircle2, ClipboardCheck, Clock, Copy, Download, Flag, Star, X } from 'lucide-react';
import { listForModeration, searchForModeration, setListingStatus, toggleFeatured, flagListing, clearFlag, setPipelineStage, updateListingAsModerator, archiveListing, restoreListing, listDuplicateClusters, moderationSummary } from '../../services/propertyService.js';
import { chaseOwner } from '../../services/outreachService.js';
import { startPropertyReview, decidePropertyReview } from '../../services/propertyReviewService.js';
import { saveNoteIfAny } from '../../components/ui/InternalNote.jsx';
import { fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { computeQualityScore, qualityLabel } from '../../lib/qualityScore.js';
import { freshnessState } from '../../lib/freshness.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { canWriteModule } from '../../lib/adminModules.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import Select from '../../components/ui/Select.jsx';
import Loading from '../../components/ui/Loading.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';
import DealPills from '../../components/ui/DealPills.jsx';
import QualityPills from '../../components/ui/QualityPills.jsx';
import AdminPropertyCard from '../../components/admin/AdminPropertyCard.jsx';
import PipelineTab from './properties/PipelineTab.jsx';
import DuplicatesTab from './properties/DuplicatesTab.jsx';
import PropertyReviewModal from './properties/PropertyReviewModal.jsx';
import { PropertyEditModal, PropertyFlagModal, PropertyArchiveModal, PropertyViewModal, PropertyBulkRejectModal, PropertyRecheckRejectModal } from './properties/PropertyModals.jsx';
import { STATUS_OPTS, PAGE_LIMIT, KPI_TINTS, fmtAgo, exportCsv } from './properties/constants.js';

// The verification routes bind `{id}` as a UUID while `propertyMapper` sets `id` to `slug || id`,
// so only the review calls need the real key off `uuid`.
const pid = (listing) => listing?.uuid || listing?.id;

const PaginationHint = ({ total }) =>
  total > PAGE_LIMIT ? (
    <p className="text-center text-xs text-gray-500 pt-2">Showing {PAGE_LIMIT} of {total} — use filters to narrow down</p>
  ) : null;

// `value == null` draws an em-dash: every fetch behind this strip resolves to `null` on failure,
// and `fmtNum(null)` would print "0" — a tile that lost its server must not look like a clean queue.
function KpiCard({ label, value, icon: Icon, tint, onClick }) {
  return (
    <button type="button" onClick={onClick} title={`View ${label} listings`} className="group dz-card p-4 sm:p-5 text-left transition hover:border-brand-teal/40 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand-teal/40">
      <div className="flex items-start justify-between">
        <span className={classNames('grid h-10 w-10 place-items-center rounded-xl', KPI_TINTS[tint])}><Icon className="h-5 w-5" /></span>
        <ArrowUpRight className="h-4 w-4 text-gray-500 transition group-hover:text-brand-teal" />
      </div>
      <div className="mt-3 text-2xl font-extrabold">{value == null ? '\u2014' : fmtNum(value)}</div>
      <div className="text-sm text-gray-400">{label} listings</div>
    </button>
  );
}

/* `[]` means "nothing waiting" and `null` means "we do not know yet", so an outage never reads as
   a drained queue. Module scope so the mount effect needs no dependency on the component's toast. */
const fetchRecheckQueue = (onError) => listForModeration({ recheck: true, archived: false }, 'newest')
  .catch((err) => { onError(err); return []; });

/* The duplicate count and clusters come from the server, and stay `null` until the read answers or
   while an error stands: `0` is a claim about the catalogue this control cannot make on its own. */

// Each queue asks the database its own question, because a predicate the database cannot see cannot
// page. `null`, `failed` and `[]` stay distinct, and `stale` makes rows inert until they answer `key`.
function useModerationQueue(filters, reloadToken) {
  const key = JSON.stringify(filters);
  // The key the settled page answers, tracked with it rather than beside it so the two can never be
  // read out of step.
  const [state, setState] = useState({ page: null, failed: false, key: null });
  const debounced = Boolean(filters.q);
  useEffect(() => {
    let alive = true;
    const run = () => {
      searchForModeration(JSON.parse(key), 'newest')
        .then((res) => { if (alive) { setState({ page: res, failed: false, key }); } })
        .catch((err) => {
          console.error('[AdminProperties] moderation queue failed', key, err);
          if (alive) { setState({ page: null, failed: true, key }); }
        });
    };
    if (!debounced) {
      run();
      return () => { alive = false; };
    }
    const t = setTimeout(run, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [key, reloadToken, debounced]);
  return useMemo(
    // Not stale before the first answer: `page` is null there, so the tab renders its loading gate
    // and there are no rows to act on anyway. Calling that "stale" would double-report it.
    () => ({ page: state.page, failed: state.failed, stale: state.key != null && state.key !== key }),
    [state, key],
  );
}

// Compared against the server's `total` rather than `>= PAGE_SIZE`: the row array hitting the cap
// cannot say how many are missing, and reads a queue of exactly one page as truncated.
function QueueTruncated({ page, noun, testId }) {
  if (page == null || page.items.length >= page.total) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100" data-testid={testId}>
      <span className="font-semibold">{fmtNum(page.total)} {noun}.</span>{' '}
      Only the newest {fmtNum(page.items.length)} are on this page — narrow with the search box or
      the filters above to reach the rest.
    </div>
  );
}

// `pointer-events-none` is the load-bearing part: rows answering a superseded term still carry
// Approve/Reject/Remind. Module scope, since a component declared during render remounts the queue.
function QueueBody({ stale, children }) {
  return (
    <div
      aria-busy={stale || undefined}
      className={stale ? 'pointer-events-none select-none opacity-50' : undefined}
      data-testid={stale ? 'queue-updating' : undefined}
    >
      {children}
    </div>
  );
}

// Worth a component because the wording is the point: the default "No listings match your filters"
// after a 500 would tell the operator the backlog is clear on the strength of an unanswered request.
function QueueFailed({ noun, testId }) {
  return (
    <p className="dz-card p-8 text-center text-gray-400" data-testid={testId}>
      Could not load the {noun} queue. This is a failed request, not an empty queue — retry before
      acting on it.
    </p>
  );
}

export default function AdminProperties() {
  const { toast } = useToast();
  const reportRecheckLoadError = useCallback(
    (err) => toast(`Could not load the re-check queue: ${err.message}`, 'error'),
    [toast],
  );
  const { optionEnabled } = useAdminFlags();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [all, setAll] = useState(null);
  // `duplicates` is absent from the valid list on a live build, so a bookmarked `?tab=duplicates`
  // falls back to All Listings rather than opening a missing tab.
  const [tab, setTab] = useTabParam(
    ['all', 'pipeline', 'verify', 'followup', 'staff', 'flagged', 'recheck', 'featured', 'duplicates'],
    'all',
  );

  /* A reviewer who can read the supply console but not write it is locked to the Verification
     Queue, whose `decideVerification` route the server guards with its own `properties:write`. */
  const verifyOnly = !canWriteModule(user, 'properties');
  const activeTab = verifyOnly ? 'verify' : tab;

  const [qAll, setQAll] = useState('');
  const [qVerify, setQVerify] = useState('');
  const [qFlagged, setQFlagged] = useState('');
  const [qRecheck, setQRecheck] = useState('');
  const [qFeatured, setQFeatured] = useState('');
  const [qStaff, setQStaff] = useState('');
  const [qFollowUp, setQFollowUp] = useState('');
  const [followUpSub, setFollowUpSub] = useState('all');
  const [dateRange, setDateRange] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDeal, setFDeal] = useState('');
  const [fQuality, setFQuality] = useState('');

  const [selAll, setSelAll] = useState(() => new Set());
  const [selVer, setSelVer] = useState(() => new Set());

  const [review, setReview] = useState(null);
  const [edit, setEdit] = useState(null);
  const [flagFor, setFlagFor] = useState(null);
  const [flagReason, setFlagReason] = useState('');
  const [archiveFor, setArchiveFor] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [view, setView] = useState(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [recheckRejectFor, setRecheckRejectFor] = useState(null);
  const [recheckRejectReason, setRecheckRejectReason] = useState('');
  const [internalNote, setInternalNote] = useState('');

  // Fetched on its own axis: slicing the page's single capped fetch would show only the re-checks that
  // land in it. `archived: false` is explicit because archiving does not clearRecheck().
  const [recheckAll, setRecheckAll] = useState(null);

  // The database counting the whole catalogue, not this page counting its capped hundred rows. `null`
  // rather than zero on failure, so `KpiCard`'s em-dash says "we do not know" instead of "all clear".
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(() => moderationSummary()
    .then(setSummary)
    .catch((err) => {
      console.error('[AdminProperties] moderation summary unavailable', err);
      setSummary(null);
    }), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Bumped by `refresh()` to re-run the All tab's server query and the summary, both otherwise keyed only
  // on the filters — without it the moderator's own action is the one change the screen will not show them.
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = () => Promise.all([
    listForModeration({}, 'newest').then(setAll),
    fetchRecheckQueue(reportRecheckLoadError).then(setRecheckAll),
    loadSummary(),
  ]).finally(() => setReloadToken((n) => n + 1));

  useEffect(() => {
    let alive = true;
    listForModeration({}, 'newest').then((rows) => { if (alive) setAll(rows); });
    fetchRecheckQueue(reportRecheckLoadError).then((rows) => { if (alive) setRecheckAll(rows); });
    return () => { alive = false; };
    // `reportRecheckLoadError` is memoised on `toast`, which `ToastContext` memoises in turn, so
    // this stays a mount-only fetch — and the `alive` guard covers it if that ever stops being true.
  }, [reportRecheckLoadError]);

  // The queue's age is the screen's whole point, so it cannot be frozen at render time: without a tick
  // a console left open never escalates a row to overdue, and the pressure to drain it stops applying.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAgeTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Deep-link handling — ?tab= is resolved by useTabParam; the ?review= half lives further down,
  // next to the queue it resolves against.
  const deepLinkHandled = useRef(false);

  const jumpTo = (t, status) => { setTab(t); if (t === 'all') { setQAll(''); setFDeal(''); setFStatus(status || ''); } };

  // ---- computed data ----
  /* `null` rather than `0` on failure: a tile rendering `0` because a fetch rejected is an all-clear
     nobody issued, and it ends the moderator's search. `KpiCard` shows an em-dash instead. */
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
    // Keyed on `reloadToken`, not `all`: the clusters are derived server-side from the whole
    // catalogue, so the page of listings this component holds is not an input to them.
  }, [reloadToken]);

  // A re-check nobody is told about is no re-check at all, and this queue has no other way to announce
  // itself: its listings are live, approved and un-archived, so they raise none of the other counters.
  const recheckCount = (recheckAll || []).length;

  /* The All tab runs its own server query so `q`, `status` and `archived` are database predicates.
     Debounced only while typing — a filter chip is a deliberate click and waiting just reads as lag. */
  const [allPage, setAllPage] = useState(null);
  const [allFailed, setAllFailed] = useState(false);
  /* Which query the settled page answers — see `useModerationQueue`'s note on `stale`. This tab
     runs its own fetch rather than the hook, so it has to carry the same flag itself. */
  const [allKey, setAllKey] = useState(null);
  const allQueryKey = JSON.stringify([qAll.trim(), fStatus, fDeal]);
  useEffect(() => {
    let alive = true;
    const q = qAll.trim();
    const run = () => {
      searchForModeration({
        q: q || undefined,
        deal: fDeal || undefined,
        // Archived is a view on its own axis, not a status. Left unset, an unfiltered moderation
        // read includes archived rows, mixing soft-deleted listings into the live catalogue.
        ...(fStatus === 'archived'
          ? { archived: true }
          : { archived: false, status: fStatus || undefined }),
      }, 'newest')
        .then((res) => { if (alive) { setAllPage(res); setAllFailed(false); setAllKey(allQueryKey); } })
        .catch((err) => {
          console.error('[AdminProperties] moderation search failed', err);
          // `null` rows, not `[]`. An empty array renders "No listings match your filters", which
          // is a claim about the catalogue; a failed request has made no such claim.
          if (alive) { setAllPage(null); setAllFailed(true); setAllKey(allQueryKey); }
        });
    };
    const t = setTimeout(run, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [qAll, fStatus, fDeal, reloadToken, allQueryKey]);
  const allStale = allKey != null && allKey !== allQueryKey;

  /* `dateRange` has no query parameter and quality is a client-computed score, so both narrow within
     the fetched page — which is why the counter below stops quoting a catalogue total when they run. */
  const rowsAll = useMemo(() => {
    const list = allPage?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => {
      if (cutoff && new Date(l.createdAt).getTime() < cutoff) return false;
      if (fQuality && qualityLabel(computeQualityScore(l)) !== fQuality) return false;
      return true;
    });
  }, [allPage, dateRange, fQuality]);

  /* Counts the server's `total` for the current query. "on this page" is a claim about truncation,
     so it is only made when the page really is truncated. */
  const narrowedLocally = Boolean(dateRange || fQuality);
  const allTruncated = allPage != null && allPage.items.length < allPage.total;
  const allCountLabel = allPage == null
    ? 'listings'
    : narrowedLocally && allTruncated
      ? `of ${fmtNum(allPage.items.length)} on this page (${fmtNum(allPage.total)} match the filters above)`
      : `of ${fmtNum(allPage.total)} listings`;

  /* Each queue is its own server query; `deal` and `q` are database predicates via `adminTextSearch`
     (title, locality, owner name, owner mobile, id). The date pills stay page-local — no parameter. */
  const verifyQueue = useModerationQueue({ status: 'pending', archived: false, q: qVerify || undefined, deal: fDeal || undefined }, reloadToken);
  const flaggedQueue = useModerationQueue({ status: 'flagged', archived: false, q: qFlagged || undefined, deal: fDeal || undefined }, reloadToken);
  const featuredQueue = useModerationQueue({ featured: true, archived: false, q: qFeatured || undefined, deal: fDeal || undefined }, reloadToken);
  const staffQueue = useModerationQueue({ postedByAdmin: true, archived: false, q: qStaff || undefined, deal: fDeal || undefined }, reloadToken);
  // The one queue whose rows are live in search right now, which is why it needs a desk. Never predicate
  // it on `real` — a mock-store field the http mapper never emits, which hid fifty-three listings.
  const unconfirmedQueue = useModerationQueue({ status: 'approved', archived: false, unconfirmed: true, q: qFollowUp || undefined, deal: fDeal || undefined }, reloadToken);
  /* Its own fetch, because the follow-up tab asks the verification queue's question with its own
     search box: a shared fetch would let whichever box was typed in last re-cut both splits. */
  const followUpQueue = useModerationQueue({ status: 'pending', archived: false, q: qFollowUp || undefined, deal: fDeal || undefined }, reloadToken);

  // No `q` term in the row filters: the server matches owner *mobile* and these predicates cannot, so
  // the browser would throw away the row the server found. The date pills have no query parameter.

  const rowsVerify = useMemo(() => {
    const list = verifyQueue.page?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => !cutoff || new Date(l.createdAt).getTime() >= cutoff);
  }, [verifyQueue, dateRange]);

  const rowsFlagged = useMemo(() => {
    const list = flaggedQueue.page?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => !cutoff || new Date(l.createdAt).getTime() >= cutoff);
  }, [flaggedQueue, dateRange]);

  // Oldest first, always: the only meaningful ordering is how long a listing has been live-but-unreviewed,
  // and re-sorting lets a moderator work the easy end. Server-side sort is clamped to the public whitelist.
  const rowsRecheck = useMemo(() => {
    const list = recheckAll || [];
    const q = qRecheck.toLowerCase();
    // The shared date pills mean "queued in the last N days" here, not "posted": a stale listing
    // repriced this morning belongs at the top of this queue.
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list
      .filter((l) => (!fDeal || l.deal === fDeal)
        && (!q || (l.title + l.owner + l.locality + l.id).toLowerCase().includes(q))
        // A row with no timestamp survives every cutoff: NaN comparisons are all false, so the
        // naive form would drop exactly the rows whose age is unknown and likely oldest.
        && (!cutoff || !l.recheckRequestedAt || new Date(l.recheckRequestedAt).getTime() >= cutoff))
      .sort((a, b) => new Date(a.recheckRequestedAt || 0) - new Date(b.recheckRequestedAt || 0));
  }, [recheckAll, qRecheck, dateRange, fDeal]);

  const rowsFeatured = useMemo(() => {
    const list = featuredQueue.page?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => !cutoff || new Date(l.createdAt).getTime() >= cutoff);
  }, [featuredQueue, dateRange]);

  // Filtered on `postedByAdmin`, the indexable column, rather than `postedByStaff`, an id inside a jsonb
  // map. `markPostedOnBehalf` writes both, so the sets match, but only one can be queried.
  const rowsStaff = useMemo(() => {
    const list = staffQueue.page?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => !cutoff || new Date(l.createdAt).getTime() >= cutoff);
  }, [staffQueue, dateRange]);

  // Runs over the *complete* pending queue, not the shared page — the difference between "no listing has
  // waited more than 48 hours" and "no listing in the newest hundred has".
  const { rowsFollowUp, rowsStale, rowsAwaiting } = useMemo(() => {
    const list = followUpQueue.page?.items || [];
    const now = Date.now();
    const stale = [];
    const awaiting = [];
    list.forEach((l) => {
      const created = new Date(l.createdAt).getTime();
      const isStale = (now - created) > 48 * 60 * 60 * 1000;
      const isAwaitingOwner = l.postedByAdmin && (!l.photosUploaded || !l.identityVerified);
      if (isAwaitingOwner) awaiting.push(l);
      else if (isStale) stale.push(l);
    });
    const byCreated = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
    stale.sort(byCreated);
    awaiting.sort(byCreated);
    return { rowsFollowUp: [...stale, ...awaiting], rowsStale: stale, rowsAwaiting: awaiting };
  }, [followUpQueue]);

  const rowsUnconfirmed = useMemo(() => {
    const list = unconfirmedQueue.page?.items || [];
    return [...list]
      .sort((a, b) => new Date(a.freshenedAt || a.createdAt) - new Date(b.freshenedAt || b.createdAt));
  }, [unconfirmedQueue]);

  const activeFollowUp =
    followUpSub === 'unconfirmed' ? rowsUnconfirmed :
    followUpSub === 'stale' ? rowsStale :
    followUpSub === 'awaiting' ? rowsAwaiting :
    rowsFollowUp;
  /* The follow-up tab switches between two different fetches, so its loading, failure and
     truncation states have to follow the sub-filter rather than being pinned to one of them. */
  const activeFollowUpQueue = followUpSub === 'unconfirmed' ? unconfirmedQueue : followUpQueue;

  /* Resolves an id against every page on the client: each queue is its own fetch, so a row selected
     on one tab can be absent from `all`. The bulk callers throw on a miss rather than absorbing it. */
  const findListing = useCallback((id) => [
    verifyQueue.page?.items, flaggedQueue.page?.items, featuredQueue.page?.items,
    staffQueue.page?.items, unconfirmedQueue.page?.items, allPage?.items, recheckAll, all,
  ].reduce((hit, rows) => hit || (rows || []).find((l) => l.id === id), undefined),
  [verifyQueue, flaggedQueue, featuredQueue, staffQueue, unconfirmedQueue, allPage, recheckAll, all]);

  /* `?review=<id>` resolves through `findListing` across every loaded page, since a decision moves a
     listing off the pending queue and its case file must stay reachable. A miss is reported, not ignored. */
  const deepLinkSettled = [verifyQueue, flaggedQueue, featuredQueue, staffQueue, unconfirmedQueue]
    .every((qz) => qz.page || qz.failed) && (allPage != null || allFailed);
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const reviewId = params.get('review');
    if (!reviewId) { deepLinkHandled.current = true; return; }
    const listing = findListing(reviewId);
    if (listing) {
      deepLinkHandled.current = true;
      setTab('verify');
      setReview(listing);
      return;
    }
    // Not a miss until every source has answered — otherwise the first queue to land decides.
    if (!deepLinkSettled) return;
    deepLinkHandled.current = true;
    toast(`No listing ${reviewId} in the loaded queues — it may have been archived, or be older than the current page`, 'error');
  }, [findListing, deepLinkSettled, params, toast]);

  // ---- selection ----
  const selAllIds = useMemo(() => rowsAll.filter((l) => selAll.has(l.id)).map((l) => l.id), [rowsAll, selAll]);
  const selVerIds = useMemo(() => rowsVerify.filter((l) => selVer.has(l.id)).map((l) => l.id), [rowsVerify, selVer]);
  const toggleOne = (setFn) => (id) => setFn((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleOneAll = toggleOne(setSelAll);
  const toggleOneVer = toggleOne(setSelVer);

  // ---- actions ----
  // Awaited and surfaced: these are real writes that can 403 (self-dealing is refused) or 404.
  const doFeature = async (l) => {
    try {
      await toggleFeatured(l.id);
    } catch (err) {
      toast(`Could not update featured: ${err.message}`, 'error');
      return;
    }
    const nowFeatured = !l.featured;
    toast(nowFeatured ? 'Marked as featured' : 'Removed from featured');
    refresh();
  };
  const doClearFlag = async (l) => {
    if (!window.confirm(`Clear the flag on "${l.title}"?`)) return;
    try {
      await clearFlag(l.id);
    } catch (err) {
      toast(`Could not clear the flag: ${err.message}`, 'error');
      return;
    }
    // Clearing a flag withdraws the complaint, it does not verify the listing: the server returns
    // the row to `pending`, so the board moves it back into the review queue on refresh.
    toast('Flag cleared — back in the review queue', 'success');
    refresh();
  };
  // Both outcomes are ordinary status transitions: `PropertyModerationService` clears the re-check on any
  // `setStatus`, so re-approving is the "checked it, all fine" action and this queue needs no endpoint.
  const doRecheckPass = async (l) => {
    if (!window.confirm(`Re-check "${l.title}" — confirm ${l.recheckReason || 'the edited fields'} look fine?`)) return;
    try {
      await setListingStatus(l.id, 'approved');
    } catch (err) {
      toast(`Could not clear the re-check: ${err.message}`, 'error');
      return;
    }
    toast('Re-check cleared — listing stays live', 'success');
    refresh();
  };
  const openRecheckReject = (l) => { setRecheckRejectFor(l); setRecheckRejectReason(''); };
  const submitRecheckReject = async () => {
    const r = recheckRejectReason.trim();
    if (!r) { toast('Add a reason before rejecting', 'error'); return; }
    const target = recheckRejectFor;
  // One call writes the case file, the status and the owner's reason together — a takedown an owner
  // cannot see the reason for cannot be appealed. `startPropertyReview` first because deciding 404s.
    const l = findListing(target.id) || target;
    try {
      await startPropertyReview(pid(l));
      await decidePropertyReview(pid(l), 'reject', r);
    } catch (err) {
      toast(`Could not reject: ${err.message}`, 'error');
      return;
    }
    setRecheckRejectFor(null);
    setRecheckRejectReason('');
    toast('Listing rejected and removed from search', 'success');
    refresh();
  };

  const doArchive = (l) => { setArchiveFor(l); setArchiveReason(''); setInternalNote(''); };
  const submitArchive = async () => { try { await archiveListing(archiveFor.id, archiveReason.trim() || undefined); } catch (err) { toast(`Could not archive: ${err.message}`, 'error'); return; } const noted = await saveNoteIfAny('listing', archiveFor.id, internalNote, 'Archived'); setArchiveFor(null); toast(noted.error ? 'Listing archived \u2014 but the internal note could not be saved' : 'Listing archived', noted.error ? 'error' : undefined); refresh(); };
  const doRestore = async (l) => { if (!window.confirm(`Restore "${l.title}"?`)) return; try { await restoreListing(l.id); } catch (err) { toast(`Could not restore: ${err.message}`, 'error'); return; } toast('Listing restored — moved to pending review', 'success'); refresh(); };
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
  // `bhkNum`, not the rendered `bhk`: the card label is "3 BHK" (and "" for a plot), so seeding the box
  // with it sends prose back out where the contract wants an integer.
  const openEdit = (l) => { setEdit({ id: l.id, title: l.title || '', price: l.price ?? '', area: l.area ?? '', bhk: l.bhkNum ? String(l.bhkNum) : '', type: l.type || '', locality: l.locality || '', deal: l.deal || 'buy', status: l.status || 'pending', _ref: l }); };
  // Two calls: `ListingUpdate` deliberately omits `status` so a PATCH cannot self-escalate, so a
  // modal changing fields and status has to send them separately.
  const submitEdit = async () => {
    const title = edit.title.trim();
    const price = +edit.price;
    const area = edit.area === '' ? '' : +edit.area;
    const loc = edit.locality.trim();
    if (!title) return toast('Title is required', 'error');
    if (Number.isNaN(price) || price <= 0) return toast('Enter a valid price', 'error');
    if (area !== '' && (Number.isNaN(area) || area < 0)) return toast('Area must be a positive number', 'error');
    if (!loc) return toast('Locality is required', 'error');
  // Both names go out: `bhkNum` is what the wire mapper reads, `bhk` the label the mock store renders. An
  // empty box is omitted rather than sent as 0 — 0 marks plots and studios, so it would reclassify a flat.
    const bhkRaw = String(edit.bhk ?? '').trim();
    const bhkNum = bhkRaw === '' ? undefined : Number(bhkRaw);
    if (bhkNum !== undefined && (!Number.isInteger(bhkNum) || bhkNum < 0)) {
      return toast('Configuration must be a whole number of bedrooms', 'error');
    }
    const bhkPatch = bhkNum === undefined ? {} : { bhkNum, bhk: bhkNum ? `${bhkNum} BHK` : '' };
    try {
      /* The moderator route, not the owner's: `/me/listings/{id}` resolves owner-scoped, so it 404s for
         every listing the moderator does not own. Mock mode hides this — its store has no owner to check. */
      await updateListingAsModerator(edit.id, { title, price, area: area || edit._ref.area, ...bhkPatch, type: edit.type.trim(), locality: loc, deal: edit.deal });
      if (edit.status && edit.status !== edit._ref.status) await setListingStatus(edit.id, edit.status);
    } catch (err) {
      toast(`Could not save: ${err.message}`, 'error');
      return;
    }
    setEdit(null);
    toast('Listing updated', 'success');
    refresh();
  };
  const openReview = (l) => { setReview(l); };

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

  // Awaited and error-branched like every other write here: against the API this can 403 (post-on-behalf
  // rights), 404, or refuse the value. The old localStorage form could not fail, so it had no error path.
  const advancePipeline = async (id, newStage) => {
    try {
      await setPipelineStage(id, newStage);
    } catch (err) {
      toast(err?.message || 'Could not move this listing', 'error');
      return;
    }
    toast('Pipeline stage updated', 'success');
    refresh();
  };

  // ---- bulk ----
  // `allSettled`: self-dealing 403s make partial failure the expected case, so report and refresh.
  const bulkFeature = async () => {
    if (!selAllIds.length) return;
    if (!window.confirm(`Toggle featured for ${selAllIds.length} listing(s)?`)) return;
    const results = await Promise.allSettled(selAllIds.map((id) => toggleFeatured(id)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const done = results.length - failed;
    if (failed) toast(`${done} updated, ${failed} failed`, 'error');
    else toast(`${done} listing(s) updated`);
    setSelAll(new Set());
    refresh();
  };
  const bulkArchive = async () => { if (!selAllIds.length) return; if (!window.confirm(`Archive ${selAllIds.length} listing(s)?`)) return; const results = await Promise.allSettled(selAllIds.map((id) => archiveListing(id, 'Bulk archive'))); const failed = results.filter((r) => r.status === 'rejected').length; const done = results.length - failed; if (failed) toast(`${done} archived, ${failed} failed`, 'error'); else toast(`${done} listing(s) archived`); setSelAll(new Set()); refresh(); };
  const bulkApprove = async () => {
    if (!selVerIds.length) return;
    if (!window.confirm(`Approve ${selVerIds.length} listing(s)?`)) return;
    const results = await Promise.allSettled(selVerIds.map(async (id) => {
      const l = findListing(id);
      // Throw rather than return: `Promise.allSettled` counts a rejection, so a quiet return would
      // drop the row from both halves of the tally and report a clean run.
      if (!l) throw new Error(`listing ${id} is no longer on this page`);
      /* The same call single-row Approve makes: opening a case file seeds an all-unticked checklist and the
         gate 409s on every row, which is the right answer to ticking forty listings from a table. */
      await setListingStatus(l.id, 'approved');
    }));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const done = results.length - failed;
    if (failed) toast(`${done} approved, ${failed} failed`, 'error');
    else toast(`${done} listing(s) approved & published`, 'success');
    setSelVer(new Set());
    refresh();
  };
  const submitBulkReject = async () => {
    const reason = bulkReason.trim();
    if (!reason) { toast('Add a reason before rejecting', 'error'); return; }
    const results = await Promise.allSettled(selVerIds.map(async (id) => {
      const l = findListing(id);
      if (!l) throw new Error(`listing ${id} is no longer on this page`);
      await startPropertyReview(pid(l));
      await decidePropertyReview(pid(l), 'reject', reason);
    }));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const done = results.length - failed;
    if (failed) toast(`${done} rejected, ${failed} failed`, 'error');
    else toast(`${done} listing(s) rejected`, 'error');
    setBulkRejectOpen(false);
    setBulkReason('');
    setSelVer(new Set());
    refresh();
  };

  // ---- export ----
  const exportCurrentCsv = () => {
    if (activeTab === 'verify') exportCsv('draazy-verification-queue.csv', ['ID', 'Title', 'BHK', 'Type', 'Locality', 'Price', 'Owner', 'Mobile', 'Submitted'], rowsVerify.map((l) => [l.id, l.title, l.bhk, l.type, l.locality, l.price, l.owner, l.ownerMobile, l.createdAt]));
    else if (activeTab === 'flagged') exportCsv('draazy-flagged.csv', ['ID', 'Title', 'Locality', 'Price', 'Owner', 'Reason'], rowsFlagged.map((l) => [l.id, l.title, l.locality, l.price, l.owner, l.flagReason || 'Flagged']));
    else if (activeTab === 'recheck') exportCsv('draazy-recheck-queue.csv', ['ID', 'Title', 'Locality', 'Price', 'Owner', 'Changed fields', 'Queued at', 'Waiting'], rowsRecheck.map((l) => [l.id, l.title, l.locality, l.price, l.owner, l.recheckReason || '', l.recheckRequestedAt || '', fmtAgo(l.recheckRequestedAt)]));
    else if (activeTab === 'featured') exportCsv('draazy-featured.csv', ['ID', 'Title', 'Locality', 'Price', 'Views', 'Enquiries'], rowsFeatured.map((l) => [l.id, l.title, l.locality, l.price, l.views, l.enquiries]));
    else exportCsv('draazy-listings.csv', ['ID', 'Title', 'BHK', 'Type', 'Locality', 'Price', 'Owner', 'Mobile', 'Views', 'Enquiries', 'Deal', 'Status', 'Featured'], rowsAll.map((l) => [l.id, l.title, l.bhk, l.type, l.locality, l.price, l.owner, l.ownerMobile, l.views, l.enquiries, l.deal, l.status, l.featured ? 'Yes' : 'No']));
  };

  /* Each tab waits for its own fetch: "No listings match your filters" is a claim about the
     catalogue, and a queue must not make it while its own request is still in flight. */
  const TAB_GATE = {
    all: () => allPage == null && !allFailed,
    verify: () => verifyQueue.page == null && !verifyQueue.failed,
    followup: () => activeFollowUpQueue.page == null && !activeFollowUpQueue.failed,
    staff: () => staffQueue.page == null && !staffQueue.failed,
    flagged: () => flaggedQueue.page == null && !flaggedQueue.failed,
    recheck: () => !recheckAll,
    featured: () => featuredQueue.page == null && !featuredQueue.failed,
    pipeline: () => !all,
  };
  if (TAB_GATE[activeTab]?.()) return <Loading />;

  const tabItems = [
    { key: 'all', label: 'All Listings' },
    { key: 'verify', label: 'Verification Queue' },
    { key: 'followup', label: 'Needs Follow-up' },
    { key: 'staff', label: 'Staff Posted' },
    { key: 'flagged', label: 'Flagged' },
    { key: 'recheck', label: recheckCount ? `Re-check Queue (${recheckCount})` : 'Re-check Queue' },
    { key: 'featured', label: 'Featured' },
    { key: 'duplicates', label: dupCount ? `Duplicates (${dupCount})` : 'Duplicates' },
    { key: 'pipeline', label: 'Pipeline' },
  ];
  const visibleTabs = verifyOnly ? tabItems.filter((t) => t.key === 'verify') : tabItems;

  const actions = { onView: setView, onEdit: openEdit, onFeature: doFeature, onFlag: openFlag, onClearFlag: doClearFlag, onArchive: doArchive, onRestore: doRestore, onReview: openReview, onReminder: handleReminder, onRecheckPass: doRecheckPass, onRecheckFail: openRecheckReject };

  /* Looked up from `activeTab` rather than threaded through `renderListTab`'s ten arguments.
     Re-check and Pipeline are absent: neither has a server `q`, so neither can fall out of step. */
  const staleByTab = {
    all: allStale,
    verify: verifyQueue.stale,
    followup: activeFollowUpQueue.stale,
    staff: staffQueue.stale,
    flagged: flaggedQueue.stale,
    featured: featuredQueue.stale,
  };
  const rowsAreStale = Boolean(staleByTab[activeTab]);

  const renderListTab = (rows, query, setQuery, placeholder, countLabel, extraFilters, cardActions, selectable, selected, onSelect) => (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="dz-input sm:w-72" />
        {extraFilters}
        <DealPills value={fDeal} onChange={setFDeal} />
        <DateRangePills value={dateRange} onChange={setDateRange} />
        <span className="ml-auto text-sm text-gray-400">
          {rowsAreStale ? 'Searching\u2026' : `${rows.length} ${countLabel}`}
        </span>
      </div>
      <QueueBody stale={rowsAreStale}>
        {rows.length === 0 ? (
          <p className="dz-card p-8 text-center text-gray-500">No listings match your filters</p>
        ) : (
          <div className="space-y-3">
            {rows.slice(0, PAGE_LIMIT).map((l) => (
              <AdminPropertyCard key={l.id} listing={l} selectable={selectable} selected={selected?.(l.id)} onSelect={onSelect} showQualityScore={optionEnabled('properties.qualityScore')} actions={cardActions} />
            ))}
            <PaginationHint total={rows.length} />
          </div>
        )}
      </QueueBody>
    </div>
  );

  return (
    <div>
      <PageHeader title="Properties" subtitle={verifyOnly ? 'Review, verify and approve every listing before it goes live' : 'Manage, verify and curate every listing'} actions={optionEnabled('properties.csvExport') ? <button onClick={exportCurrentCsv} className="dz-btn dz-btn-ghost"><Download className="h-4 w-4" /> Export CSV</button> : null} />

      {/* KPI cards */}
      {!verifyOnly && (
      <div className="mb-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <KpiCard label="Total" value={summary?.total} icon={Building2} tint="indigo" onClick={() => jumpTo('all', '')} />
        <KpiCard label="Active" value={summary?.approved} icon={CheckCircle2} tint="emerald" onClick={() => jumpTo('all', 'approved')} />
        <KpiCard label="Pending" value={summary?.pending} icon={Clock} tint="amber" onClick={() => jumpTo('verify', '')} />
        <KpiCard label="Flagged" value={summary?.flagged} icon={Flag} tint="rose" onClick={() => jumpTo('flagged', '')} />
        <KpiCard label="Re-check" value={summary?.recheck} icon={ClipboardCheck} tint="amber" onClick={() => setTab('recheck')} />
        <KpiCard label="Duplicate" value={dupCount} icon={Copy} tint="rose" onClick={() => setTab('duplicates')} />
        <KpiCard label="Featured" value={summary?.featured} icon={Star} tint="teal" onClick={() => jumpTo('featured', '')} />
      </div>
      )}

      {/* Tabs */}
      <HScroll role="tablist" wrapClassName="mb-4" fadeColor="var(--brand-card, #1a1730)" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {visibleTabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={activeTab === t.key} onClick={() => setTab(t.key)} className={classNames('flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition', activeTab === t.key ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {t.label}
          </button>
        ))}
      </HScroll>

      {/* Tab content */}
      {activeTab === 'all' && (
        <>
          {optionEnabled('properties.bulkOps') && selAllIds.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="font-semibold">{selAllIds.length} selected</span><div className="flex-1" />
              <button onClick={bulkFeature} className="dz-btn dz-btn-ghost dz-btn-sm"><Star className="h-4 w-4" /> Toggle featured</button>
              <button onClick={bulkArchive} className="dz-btn dz-btn-danger dz-btn-sm"><Archive className="h-4 w-4" /> Archive selected</button>
            </div>
          ) : null}
          {/* Same treatment the re-check queue already gets: a page smaller than the match is said
              out loud, rather than left to be inferred from a row count nobody compares. */}
          {allTruncated && (
            <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100" data-testid="all-truncated">
              <span className="font-semibold">{fmtNum(allPage.total)} listings match.</span>{' '}
              Only the newest {fmtNum(allPage.items.length)} are on this page — narrow with the search
              box or the filters above to reach the rest.
            </div>
          )}
          {allFailed ? (
            <p className="dz-card p-8 text-center text-gray-400" data-testid="all-error">
              Could not load listings. This is a failed request, not an empty catalogue — retry before
              acting on it.
            </p>
          ) : allPage == null ? (
            <Loading />
          ) : renderListTab(rowsAll, qAll, setQAll, 'Search title, owner, locality\u2026', allCountLabel,
            <><Select value={fStatus} onChange={setFStatus} options={STATUS_OPTS} className="sm:w-44" ariaLabel="Filter by status" />{optionEnabled('properties.qualityScore') && <QualityPills value={fQuality} onChange={setFQuality} />}</>,
            actions, optionEnabled('properties.bulkOps'), (id) => selAll.has(id), toggleOneAll)}
        </>
      )}

      {activeTab === 'verify' && (
        <>
          {optionEnabled('properties.bulkOps') && selVerIds.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="font-semibold">{selVerIds.length} selected</span><div className="flex-1" />
              <button onClick={bulkApprove} className="dz-btn dz-btn-success dz-btn-sm"><Check className="h-4 w-4" /> Approve selected</button>
              <button onClick={() => setBulkRejectOpen(true)} className="dz-btn dz-btn-danger dz-btn-sm"><X className="h-4 w-4" /> Reject selected</button>
            </div>
          ) : null}
          <QueueTruncated page={verifyQueue.page} noun="listings are awaiting verification" testId="verify-truncated" />
          {verifyQueue.failed ? <QueueFailed noun="verification" testId="verify-error" /> : renderListTab(rowsVerify, qVerify, setQVerify, 'Search title, owner, locality\u2026', 'pending', null,
            { onView: setView, onEdit: openEdit, onReview: openReview, onFlag: openFlag, onArchive: doArchive }, optionEnabled('properties.bulkOps'), (id) => selVer.has(id), toggleOneVer)}
        </>
      )}

      {activeTab === 'flagged' && (
        <>
          <QueueTruncated page={flaggedQueue.page} noun="listings are flagged" testId="flagged-truncated" />
          {flaggedQueue.failed ? <QueueFailed noun="flagged" testId="flagged-error" /> : renderListTab(rowsFlagged, qFlagged, setQFlagged, 'Search title, owner, locality\u2026', 'flagged', null, { onView: setView, onEdit: openEdit, onClearFlag: doClearFlag, onArchive: doArchive })}
        </>
      )}

      {/* Stays-live re-check queue (Q14). These listings are live, searchable and earning while
          they wait, so nothing about them looks wrong on any other tab — which is precisely why
          this one has to exist and has to be drained. The banner states the trade out loud rather
          than leaving it to be inferred from a tab name. */}
      {activeTab === 'recheck' && (
        <>
          <div className="mb-4 rounded-xl border border-sky-400/30 bg-sky-500/10 p-3 text-sm text-sky-100" data-testid="recheck-banner">
            <span className="font-semibold">These listings are still live.</span>{' '}
            An owner changed a buyer-facing detail (price, furnishing or possession) after approval. The
            listing stayed in search on the promise that someone re-checks it — oldest first.
          </div>
          {/* The provider asks for one page of 100 and the server's ceiling is the same, so a queue
              past 100 is returned newest-first and then sorted here — meaning the rows silently
              missing are the *oldest*, which are exactly the breached ones this tab exists to
              surface. Say so rather than presenting a truncated queue as the whole queue. */}
          {/* Compared against the server's own count rather than tested for `>= 100`. The old form
              inferred truncation from the row array having hit the page cap, which is a proxy for
              the question and not the question: it cannot say how many are missing, and it reads a
              queue of exactly 100 as truncated. */}
          {summary != null && summary.recheck > (recheckAll || []).length && (
            <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100" data-testid="recheck-truncated">
              <span className="font-semibold">{fmtNum(summary.recheck)} re-checks are queued.</span>{' '}
              Only the most recent {fmtNum((recheckAll || []).length)} are shown, so the oldest — the
              ones most overdue — are not on this page. Clear the backlog, or narrow with the filters above.
            </div>
          )}
          {renderListTab(rowsRecheck, qRecheck, setQRecheck, 'Search title, owner, locality\u2026', 'awaiting re-check', null,
            { onView: setView, onEdit: openEdit, onRecheckPass: doRecheckPass, onRecheckFail: openRecheckReject, onFlag: openFlag, onArchive: doArchive })}
        </>
      )}
      {activeTab === 'featured' && (
        <>
          <QueueTruncated page={featuredQueue.page} noun="listings are featured" testId="featured-truncated" />
          {featuredQueue.failed ? <QueueFailed noun="featured" testId="featured-error" /> : renderListTab(rowsFeatured, qFeatured, setQFeatured, 'Search title, owner, locality\u2026', 'featured', null, { onView: setView, onEdit: openEdit, onFeature: doFeature, onFlag: openFlag, onArchive: doArchive })}
        </>
      )}
      {activeTab === 'staff' && (
        <>
          <QueueTruncated page={staffQueue.page} noun="listings were posted by staff" testId="staff-truncated" />
          {/* "staff name" is gone from this placeholder. The browser-side filter used to include
              `postedByStaff`, which reads as staff-name search and was one against the mock, where
              the console wrote the display name into the row it then searched. The server derives
              that field from the caller's token, so live it is a uuid inside a jsonb map — typing
              "Priya" matched nothing then and matches nothing now. Promising it was the defect;
              removing the promise is the fix, and a real staff-name filter is a `users` join and a
              query parameter of its own. */}
          {staffQueue.failed ? <QueueFailed noun="staff-posted" testId="staff-error" /> : renderListTab(rowsStaff, qStaff, setQStaff, 'Search title, owner, locality\u2026', 'staff-posted', null, { onView: setView, onEdit: openEdit, onReview: openReview, onArchive: doArchive })}
        </>
      )}

      {activeTab === 'followup' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input value={qFollowUp} onChange={(e) => setQFollowUp(e.target.value)} placeholder={'Search title, owner, locality\u2026'} className="dz-input sm:w-72" />
            <Select value={followUpSub} onChange={setFollowUpSub} options={[{ value: 'all', label: 'All reasons' }, { value: 'stale', label: 'Stale pending' }, { value: 'awaiting', label: 'Awaiting owner' }, { value: 'unconfirmed', label: 'Unconfirmed (stale)' }]} className="sm:w-48" ariaLabel="Filter by reason" />
            <DealPills value={fDeal} onChange={setFDeal} />
            <DateRangePills value={dateRange} onChange={setDateRange} />
            <span className="ml-auto text-sm text-gray-400">
              {rowsAreStale ? 'Searching\u2026' : `${activeFollowUp.length} listings`}
            </span>
          </div>
          <QueueTruncated
            page={activeFollowUpQueue.page}
            noun={followUpSub === 'unconfirmed' ? 'live listings are unconfirmed' : 'listings are awaiting verification'}
            testId="followup-truncated"
          />
          {followUpSub === 'unconfirmed' && (
            <p className="dz-card px-4 py-3 mb-3 text-xs text-gray-400 flex items-start gap-2">
              <Clock className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
              <span>Live listings whose owners haven't confirmed availability in over {30} days. Send a WhatsApp nudge so buyers keep seeing fresh, trustworthy listings.</span>
            </p>
          )}
          {/* Wrapped for the same reason as every other queue, and this is the tab that proved the
              need: `onReminder` writes a chaser to a named owner and opens WhatsApp. Acting on a
              row that answers the previous term sends a real message to the wrong person. */}
          <QueueBody stale={rowsAreStale}>
            {activeFollowUpQueue.failed ? (
              <QueueFailed noun="follow-up" testId="followup-error" />
            ) : activeFollowUp.length === 0 ? (
              <p className="dz-card p-8 text-center text-gray-500">All caught up — no listings need follow-up right now.</p>
            ) : (
              <div className="space-y-3">
                {activeFollowUp.slice(0, PAGE_LIMIT).map((l) => (
                  <AdminPropertyCard key={l.id} listing={l} showQualityScore={optionEnabled('properties.qualityScore')} actions={followUpSub === 'unconfirmed'
                    ? { onView: setView, onEdit: openEdit, onReminder: handleConfirmReminder, reminderAlways: true, onFlag: openFlag, onArchive: doArchive }
                    : { onView: setView, onEdit: openEdit, onReview: openReview, onReminder: handleReminder, onFlag: openFlag, onArchive: doArchive }} />
                ))}
                <PaginationHint total={activeFollowUp.length} />
              </div>
            )}
          </QueueBody>
        </div>
      )}

      {/* The one tab still reading the shared page, and the only one that cannot easily stop.
          The board's columns come from `adminPipeline.pipelineStage`, a key inside a jsonb blob
          with no index and no query parameter, so there is no server axis to ask for — unlike
          `status`, `featured` and `posted_by_admin`, which are columns and are now filters. Until
          there is one, this board is the newest hundred listings and says so, because a kanban that
          silently omits cards is worse than one that admits its horizon: the desk works what it can
          see, and an invisible card is an abandoned one. */}
      {activeTab === 'pipeline' && (
        <>
          {summary != null && all != null && (summary.total + summary.archived) > all.length && (
            <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100" data-testid="pipeline-truncated">
              <span className="font-semibold">This board shows the newest {fmtNum(all.length)} listings.</span>{' '}
              The catalogue holds {fmtNum(summary.total + summary.archived)}. Pipeline stage is not yet
              a filter the server can answer, so older cards are not on this board — use the
              verification and follow-up queues to reach them.
            </div>
          )}
          <PipelineTab all={all} onAdvancePipeline={advancePipeline} />
        </>
      )}

      {activeTab === 'duplicates' && <DuplicatesTab onRefresh={refresh} />}

      {/* Modals */}
      {review && <PropertyReviewModal review={review} setReview={setReview} onRefresh={refresh} />}
      <PropertyEditModal edit={edit} setEdit={setEdit} onSubmit={submitEdit} />
      <PropertyFlagModal flagFor={flagFor} setFlagFor={setFlagFor} flagReason={flagReason} setFlagReason={setFlagReason} internalNote={internalNote} setInternalNote={setInternalNote} onSubmit={submitFlag} />
      <PropertyArchiveModal archiveFor={archiveFor} setArchiveFor={setArchiveFor} archiveReason={archiveReason} setArchiveReason={setArchiveReason} internalNote={internalNote} setInternalNote={setInternalNote} onSubmit={submitArchive} />
      <PropertyViewModal view={view} setView={setView} />
      <PropertyBulkRejectModal open={bulkRejectOpen} onClose={() => setBulkRejectOpen(false)} count={selVerIds.length} bulkReason={bulkReason} setBulkReason={setBulkReason} onSubmit={submitBulkReject} />
      <PropertyRecheckRejectModal target={recheckRejectFor} setTarget={setRecheckRejectFor} reason={recheckRejectReason} setReason={setRecheckRejectReason} onSubmit={submitRecheckReject} />
    </div>
  );
}

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

/**
 * The verification routes bind `{id}` as a UUID, and `propertyMapper` sets a listing's `id` to
 * `slug || id` with the real key on `uuid` — so `listing.id` is the wrong argument for exactly the
 * listings that have a slug. The moderation and status routes below take either, which is why only
 * the review calls go through this.
 */
const pid = (listing) => listing?.uuid || listing?.id;

const PaginationHint = ({ total }) =>
  total > PAGE_LIMIT ? (
    <p className="text-center text-xs text-gray-500 pt-2">Showing {PAGE_LIMIT} of {total} — use filters to narrow down</p>
  ) : null;

/**
 * A headline tile.
 *
 * `value == null` renders an em-dash, not a number. This is the tile's whole contract with the
 * rest of the screen: every fetch behind this strip resolves to `null` when it fails or has not
 * answered yet, and `fmtNum(null)` is `"0"` — `Number(null)` is `0`, and the `|| 0` swallows
 * `NaN` and `undefined` too. So the honest "we do not know" and the load-bearing "nothing is
 * waiting" arrived on screen as the same glyph, and the tile that had lost its server looked like
 * the tile with a clean queue. A moderator stops looking at a zero.
 */
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

/* The stays-live re-check queue's fetch (Q14).
   A failed fetch must not read as a drained queue: `[]` means "nothing waiting", `null` means "we
   do not know yet", and the tab renders a loader for the second — so an outage is never mistaken
   for an empty backlog. Module scope, with the reporter passed in, so the mount effect that calls
   it needs no dependency on the component's `toast`. */
const fetchRecheckQueue = (onError) => listForModeration({ recheck: true, archived: false }, 'newest')
  .catch((err) => { onError(err); return []; });

/* Duplicate detection used to be the one feature on this console with no server behind it, and the
   shape of its failure was worse than "unimplemented".

   `findDuplicateClusters` ran a union-find over `rawDb().listings` — the fixture store `main.jsx`
   seeds into `localStorage` at boot, unconditionally and with no reference to the domain allow-list.
   On a mock build that store *is* the catalogue and the answer was right. On a live build it was a
   copy of `db.json` that had never met a production listing, so the tile did not go blank or throw:
   it rendered a calm, confident **0**, and the tab rendered "nothing to merge".

   Measured against this lane's e2e database on 2026-08-25: the tile read `Duplicate listings: 0`
   while `GET /admin/properties` returned 71 rows containing four repeated titles, one of them four
   times over. A moderator reading that tile was being told the catalogue is clean by a control that
   never looked at it — and an all-clear nobody asked for is more expensive than a blank, because it
   ends the search. The merge button was the same problem one step further on: `resolveDuplicate`
   archived the loser into `localStorage`, so a cross-owner merge changed nothing another person
   could see and was gone when the browser was cleared. It also wrote `duplicateFlag` and
   `duplicateOf`, two columns no table on this platform has ever had.

   D255 built the missing half — `GET /admin/properties/duplicates` derives the clusters from the
   same three signals the write-time probe uses, and merge/dismiss are server writes that leave
   audit rows. So the tile and the tab are unconditional again, and the count below is the server's.

   What survives from the old arrangement is the lesson rather than the gate: this count is `null`
   until the read answers, and `null` while an error stands. It is never `0` on a catalogue nobody
   looked at, because that number is a claim and this control is not entitled to make it. */

/**
 * One queue, one server query.
 *
 * Every tab on this console used to derive itself from a single fetch of `listForModeration({})` —
 * one page, capped at a hundred rows — and then filter that page in the browser. Measured against
 * this lane's e2e database on a 322-listing catalogue, that is what the desk was actually shown:
 *
 * | tab | in the database | on the screen |
 * |---|---|---|
 * | Verification queue | 91 | 27 |
 * | Flagged | 4 | **0** |
 * | Featured | 5 | **0** |
 * | Staff posted | 67 | 27 |
 * | Unconfirmed | 53 | **0** |
 *
 * Two things are worth separating there. The verification queue at 27-of-91 is the ordinary
 * page-cap defect and reads as plausible — a moderator drains it, sees it empty, and walks away
 * from sixty-four listings. Flagged and Featured are worse than plausible: they render *empty*
 * while the KPI tiles two inches above them, which come from `GET /admin/properties/summary` and
 * are therefore right, say four and five. The page contradicts itself on screen and still nobody
 * had reported it, because an empty moderation queue is the outcome everybody wants.
 *
 * The fix is not a bigger page. It is that each queue asks the database its own question:
 * `status`, `featured`, `postedByAdmin` and `unconfirmed` are all real columns and all now real
 * query parameters. A predicate the database cannot see cannot page.
 *
 * `null` page and `failed` are distinct on purpose, and neither is `[]`. An empty array renders
 * "No listings match your filters", which is a claim about the catalogue; a request that failed has
 * made no such claim, and a queue that reports itself drained because a fetch rejected is the same
 * confident zero in a different costume.
 *
 * Keyed on the serialised filters so a caller can pass an object literal without memoising it —
 * `JSON.stringify` also drops the `undefined` values that would not have been sent anyway.
 *
 * Debounced, because `q` made these fetches keystroke-driven: an owner's name is a dozen requests
 * typed at speed, and without a delay the last one to *arrive* wins rather than the last one sent.
 * The `alive` flag already stops a stale response overwriting a fresh one, but it cannot stop the
 * requests being made. The delay is skipped when there is no term — tab switches, the deal filter
 * and `reloadToken` after a moderation decision are all single events, and making the desk wait a
 * quarter second to watch a row disappear after they approved it would be a worse screen.
 *
 * `stale` is the price of that delay, and it is not cosmetic. Moving `q` to the server put time
 * between the term the operator typed and the rows answering it; for those few hundred milliseconds
 * the list still shows the *previous* result set while the box reads the new term. Every row on it
 * carries Approve, Reject, Archive and Remind. Caught by `listing-freshness.spec.js`: the desk
 * searched one owner's listing, pressed Remind on the only row it could see, and the chaser was
 * written for a different owner entirely — a real outbound message, to the wrong person, produced
 * by a search box. So the hook says out loud when its page does not answer the current key, and the
 * list is inert until it does. This is inherent to a server-side search, not to the debounce: even
 * at zero delay the fetch is not instant.
 */
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

/**
 * Says out loud when a queue holds more than the page fetched for it.
 *
 * The same treatment the re-check queue already had, generalised — because the alternative is what
 * every other tab did, which is to present a slice as the whole and let the operator infer the
 * difference from a row count nobody compares. Compared against the server's own `total` rather
 * than tested for `>= PAGE_SIZE`: the row array hitting the cap is a proxy for the question and not
 * the question, it cannot say how many are missing, and it reads a queue of exactly one hundred as
 * truncated.
 */
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

/**
 * The list, made inert while it is answering the previous search term.
 *
 * `pointer-events-none` is the load-bearing part and the rest is so the operator can see why: the
 * rows below are a real answer to a question nobody is asking any more, and every one of them
 * carries Approve, Reject, Archive and Remind. Blanking them instead would be worse — an empty list
 * here reads as "no such listing", which is the lie this whole wave exists to stop, and it would
 * make the page jump about under somebody who is still typing.
 *
 * Module scope rather than a closure inside the page, because a component declared during render is
 * a new type on every render and React remounts its whole subtree — here, the entire queue, on
 * every keystroke.
 */
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

/**
 * The other half of `useModerationQueue`'s two-state failure: what a queue renders when its fetch
 * rejected.
 *
 * Worth a component rather than a ternary in nine places, because the wording is the point. The
 * default empty state on this screen is "No listings match your filters", and a queue that says
 * that after a 500 has told the operator the backlog is clear on the strength of a request nobody
 * answered. That is the same confident zero the KPI tiles were rebuilt to stop printing.
 */
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
  /* `duplicates` is not in the valid list on a live build, so a bookmarked `?tab=duplicates` falls
     back to All Listings rather than opening a tab that is no longer there. */
  const [tab, setTab] = useTabParam(
    ['all', 'pipeline', 'verify', 'followup', 'staff', 'flagged', 'recheck', 'featured', 'duplicates'],
    'all',
  );

  /* A reviewer who can read the supply console but not write it is locked to the Verification
     Queue — the one tab whose action (`decideVerification`) is a separate route the server guards
     with `properties:write` of its own.

     This used to be a `properties:verify` sub-scope the console invented. The server's catalogue
     has no such atom and will not grow one: verifying, featuring and archiving are all reached
     through the same `properties:write`, so a name that promised only the first was a promise the
     server could not keep. "Read without write" is the honest version of the same restriction and
     is enforced end to end. */
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

  /* The stays-live re-check queue (Q14) is fetched on its own axis rather than filtered out of
     `all` like the other list tabs.

     Every other tab narrows on something already in the page's single fetch (`status`, `featured`,
     `archived`), but a queued re-check is by definition an *approved, un-archived* listing — that
     is the whole outcome — so `all` cannot be narrowed to it without the recheck fields, and the
     moderation fetch is one page of `PAGE_SIZE` (100, set by the provider; the endpoint's own
     default of 20 is not what this screen gets). Filtering client-side would therefore quietly show
     the re-checks that happen to fall in that page and silently drop the rest, which for a queue is
     worse than showing nothing: it looks drained. `?recheck=true` asks the server the actual
     question, and the mock answers it identically.

     That argument was right and was applied to exactly one tab. It holds for all of them — the
     other eight still slice this same capped page — which is how the KPI strip came to report
     `Active 0` over 54 approved listings.

     `DuplicatesTab` already establishes a tab with its own data source.

     `archived: false` is sent explicitly rather than left to the outcome's definition. Archiving
     does not call `clearRecheck()`, and `adminSearch` adds no archived predicate when the filter is
     null, so a listing archived while a re-check was outstanding still matches `recheck=true`
     server-side. The mock drops archived rows unconditionally, so without this the two sides would
     disagree — and the live queue would carry rows that no longer need reviewing. */
  const [recheckAll, setRecheckAll] = useState(null);

  /* The headline counts, from `GET /admin/properties/summary` — the database counting the whole
     catalogue, not this page counting the rows it happens to hold.

     These five numbers used to be a `useMemo` over `all`, and `all` is one page of at most a
     hundred listings. Against a 207-row catalogue whose newest hundred rows were all pending, the
     strip painted **Active 0, Flagged 0, Featured 0** over 54 approved, 4 flagged and 5 featured
     listings, and Total 92 over 199. Nothing about that reads as broken — three tiles at zero and a
     plausible total is what a quiet morning looks like, which is exactly why it survived.

     The endpoint has existed and been correct the whole time. `PropertyModerationSummary` even
     documents this failure in the past tense, as though the console had already been moved onto it;
     it never had been, and grep found no reference to the route anywhere in the frontend. That is
     the same shape as `?recheck=true` before D-Q14 — server half shipped, tested and unreachable —
     and `toModerationQuery` says so about itself in its own javadoc. Third time on this endpoint.

     `null` until it answers, and `null` again if it fails — never a zero. `KpiCard` renders an
     em-dash for `null`, so an outage says "we do not know" instead of "all clear". */
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(() => moderationSummary()
    .then(setSummary)
    .catch((err) => {
      console.error('[AdminProperties] moderation summary unavailable', err);
      setSummary(null);
    }), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  /* Every write on this screen moves at least one of the counters — approve, flag, feature and
     archive each shift a tile — so the summary is refetched alongside the rows. Leaving it out was
     the first version, and it aged the strip into a decoration: the moderator cleared the pending
     queue and the Pending tile kept its opening number until a reload. */
  /* Bumped by `refresh()` to re-run the All tab's server query, which is otherwise keyed only on
     the filters. Without it the tab kept rendering the pre-write page: approving a listing moved
     the KPI tile and left the row sitting there as pending, and the moderator's own action was the
     one change the screen would not show them. */
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

  /* The queue's age is the screen's whole point, so it cannot be frozen at render time. Without a
     tick, a console left open on this tab never escalates a row from 23h to 25h to overdue — the
     one pressure to drain the queue would quietly stop applying to whoever is watching it. */
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
  /* The number of distinct duplicate clusters awaiting an Ops merge decision — from the server, and
     `null` until it answers or if it fails.

     `null` rather than `0` on failure is the whole point of this variable's history. The KPI reads
     "Duplicate: —" when the question is unanswered, and only ever shows a number the server
     actually computed. A tile that renders `0` because a fetch rejected is an all-clear nobody
     issued, and it is more expensive than a blank because it ends the moderator's search. */
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
    // Re-read after a write rather than after `all` changes. The clusters are derived server-side
    // from the whole catalogue, so the page of listings this component happens to hold is not an
    // input to them — keying on it was borrowing another fetch's timing for want of a signal of
    // its own, and `reloadToken` is that signal.
  }, [reloadToken]);

  /* Surfaced in the tab label and as a KPI. A re-check that nobody is *told about* is the same as
     no re-check at all, and this queue has no other way of announcing itself: the listings in it
     are live, approved and un-archived, so they raise none of the existing counters. */
  const recheckCount = (recheckAll || []).length;

  /* The All tab has its own server query, and this is the substantive half of the fix.
   *
   * It used to filter `all` — one capped page — in the browser. On a 207-listing catalogue that
   * meant 107 listings could not be found by any search term: typing an exact title of a listing
   * that exists returned "No listings match your filters". A moderation search that answers
   * "nothing" for a row it simply did not fetch is worse than one that errors, because the operator
   * believes it. `q` has been forwarded by `toModerationQuery` the whole time; nobody sent it.
   *
   * `status`/`archived` go with it, so the Active and Archived views are the database's answer
   * rather than whatever the newest hundred rows happened to contain.
   *
   * Debounced only while typing — a filter chip applies immediately, since a click is already a
   * deliberate act and waiting 250ms after one just reads as lag.
   */
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
        // Archived is a view, not a status: the server keeps it on its own axis, so asking for it
        // means `archived=true` with no status, and every other view means `archived=false`. Left
        // unset, an unfiltered moderation read includes archived rows by design — which on the All
        // tab would silently mix soft-deleted listings into the live catalogue.
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

  /* The two axes the server cannot answer, applied to the page it returned.
   *
   * `dateRange` has no parameter on `GET /admin/properties`, and quality is a score this client
   * computes from the listing's own fields — there is no column to filter on. Both therefore narrow
   * *within* the fetched page, which is why the row counter below stops quoting a catalogue total
   * whenever one of them is active: it would be describing a different set than the one on screen.
   * The freshness filter has the same shape and is already filed in `tasks/DECISIONS-NEEDED.md`. */
  const rowsAll = useMemo(() => {
    const list = allPage?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => {
      if (cutoff && new Date(l.createdAt).getTime() < cutoff) return false;
      if (fQuality && qualityLabel(computeQualityScore(l)) !== fQuality) return false;
      return true;
    });
  }, [allPage, dateRange, fQuality]);

  /* The row counter, which is the other thing that was lying.
   *
   * It read `of ${all.length} listings` — `all.length` is the page cap, so it printed "of 100" on a
   * 207-row catalogue and would print "of 100" on a million. It also counted the archived rows the
   * tab was excluding, which is how "1 of 100 listings" came to sit beside a Total tile reading 92.
   *
   * Now: the server's `total` for the current query, and when a page-local narrowing is on, the
   * count of what was actually fetched, said in those words.
   *
   * "on this page" is a claim about truncation, so it is only made when the page actually is
   * truncated. With a catalogue that fits in one fetch, the local narrowing saw every matching row,
   * `items.length` and `total` are the same number, and the long form said it twice — "3 of 41 on
   * this page (41 match the filters above)" — while implying rows had been withheld. */
  const narrowedLocally = Boolean(dateRange || fQuality);
  const allTruncated = allPage != null && allPage.items.length < allPage.total;
  const allCountLabel = allPage == null
    ? 'listings'
    : narrowedLocally && allTruncated
      ? `of ${fmtNum(allPage.items.length)} on this page (${fmtNum(allPage.total)} match the filters above)`
      : `of ${fmtNum(allPage.total)} listings`;

  /* Each queue is its own server query now — see `useModerationQueue` for what the single shared
     fetch was actually showing the desk.
   *
   * `deal` and `q` both go to the server. `q` could not until the server's term matched what these
   * boxes claim to search: it was title-or-locality, while every placeholder on this screen also
   * offers owner and listing id, so pushing it down would have traded a page-cap defect for a
   * narrower search. `adminTextSearch` now covers title, locality, owner name, owner mobile and the
   * id, so the term is a predicate the database can see — which is what the truncation banners have
   * been telling operators to do all along ("narrow with the search box to reach the rest"). Typing
   * a name that only appears on page three used to answer "no listings match your filters".
   *
   * Debounced, because this is a keystroke-driven fetch: see `useModerationQueue`.
   *
   * The date pills stay in the browser. They are a `createdAt` window with no query parameter, and
   * unlike `q` they narrow a set the operator can already see rather than reaching past the page.
   *
   * Owner *mobile* is new to these boxes and deliberately not advertised in every placeholder — the
   * three that say "owner" mean the person, and a desk with a caller on the line will try the
   * number whether or not the grey text invites it. */
  const verifyQueue = useModerationQueue({ status: 'pending', archived: false, q: qVerify || undefined, deal: fDeal || undefined }, reloadToken);
  const flaggedQueue = useModerationQueue({ status: 'flagged', archived: false, q: qFlagged || undefined, deal: fDeal || undefined }, reloadToken);
  const featuredQueue = useModerationQueue({ featured: true, archived: false, q: qFeatured || undefined, deal: fDeal || undefined }, reloadToken);
  const staffQueue = useModerationQueue({ postedByAdmin: true, archived: false, q: qStaff || undefined, deal: fDeal || undefined }, reloadToken);
  /* The one queue whose rows are approved, un-archived and live in search right now — which is why
     it needs a desk at all. It also used to be empty by construction against the live API: the
     predicate began `if (!l.real ...)`, and `real` is a mock-store field the http mapper has never
     emitted, so every live listing failed the first test. The tab read "All caught up" over
     fifty-three listings whose owners had gone silent. */
  const unconfirmedQueue = useModerationQueue({ status: 'approved', archived: false, unconfirmed: true, q: qFollowUp || undefined, deal: fDeal || undefined }, reloadToken);
  /* The follow-up tab asks the verification queue's question with its own search box, so it needs
     its own fetch: folding it back into `verifyQueue` would mean typing in the Verification tab's
     box silently re-cut the follow-up split, and typing in the follow-up box re-cut the
     verification queue. Identical requests while both boxes are empty, which is the honest cost of
     two independent controls over one question — and cheaper than the alternative, which is a
     shared fetch that answers whichever box was typed in last. */
  const followUpQueue = useModerationQueue({ status: 'pending', archived: false, q: qFollowUp || undefined, deal: fDeal || undefined }, reloadToken);

  /* The `q` term is gone from every row filter below, not merely duplicated at the server.
     Leaving it would have been worse than redundant: the server matches owner *mobile* and these
     predicates never did, so a desk searching the number of the owner on the phone would have had
     the server find the row and the browser throw it away — a search that works everywhere except
     the screen. The date pills stay, being a window with no query parameter behind it. */

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

  /* Oldest first, always. Sorting is deliberately not offered: the queue's only ordering that
     means anything is how long each listing has been live-but-unreviewed, and letting a moderator
     re-sort it is letting them work the easy end. Server-side sorting is not an option either —
     `sort` is clamped to the catalogue's shared whitelist, and widening it for `recheckRequestedAt`
     would expose the column to the public search too (see the endpoint's spec note). */
  const rowsRecheck = useMemo(() => {
    const list = recheckAll || [];
    const q = qRecheck.toLowerCase();
    // The shared date pills mean "queued in the last N days" here, not "posted" — a listing posted
    // two years ago and repriced this morning belongs at the top of this queue, and filtering it on
    // `createdAt` like the other tabs would hide exactly the rows that matter.
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list
      .filter((l) => (!fDeal || l.deal === fDeal)
        && (!q || (l.title + l.owner + l.locality + l.id).toLowerCase().includes(q))
        // A row with no timestamp survives every cutoff. `new Date('').getTime()` is NaN and every
        // NaN comparison is false, so the naive form drops precisely the rows whose age is unknown
        // — the ones the strip is prepared to render as "waiting — no timestamp", and the ones
        // most likely to be the oldest.
        && (!cutoff || !l.recheckRequestedAt || new Date(l.recheckRequestedAt).getTime() >= cutoff))
      .sort((a, b) => new Date(a.recheckRequestedAt || 0) - new Date(b.recheckRequestedAt || 0));
  }, [recheckAll, qRecheck, dateRange, fDeal]);

  const rowsFeatured = useMemo(() => {
    const list = featuredQueue.page?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => !cutoff || new Date(l.createdAt).getTime() >= cutoff);
  }, [featuredQueue, dateRange]);

  /* Filtered on `postedByAdmin`, which is the indexable column, rather than on `postedByStaff`,
     which is the staff member's id inside a jsonb map. `markPostedOnBehalf` writes both in one
     step, so the sets are the same — but only one of them is a thing the database can answer a
     question about, and the search box below still reads the staff name off the row. */
  const rowsStaff = useMemo(() => {
    const list = staffQueue.page?.items || [];
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => !cutoff || new Date(l.createdAt).getTime() >= cutoff);
  }, [staffQueue, dateRange]);

  /* The follow-up split runs over the *complete* pending queue rather than over whichever pending
     rows happened to be in the shared page — which is the difference between "no listing has been
     waiting more than 48 hours" and "no listing in the newest hundred has". */
  const { rowsFollowUp, rowsStale, rowsAwaiting } = useMemo(() => {
    const list = followUpQueue.page?.items || [];
    const now = Date.now();
    const stale = [];
    const awaiting = [];
    list.forEach((l) => {
      const created = new Date(l.createdAt).getTime();
      const isStale = (now - created) > 48 * 60 * 60 * 1000;
      const isAwaitingOwner = l.postedByAdmin && (!l.photosUploaded || !l.aadhaarVerified);
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

  /* Resolves an id back to its row. It used to search `all` alone, which was survivable only while
     every tab was a slice of `all`; now that each queue is its own fetch, a listing can be selected
     on the verification tab and absent from `all` entirely — `all` is one page and the pending queue
     is a different one. The bulk callers treated a miss as `return`, so an approve would skip the
     row, count it as neither done nor failed, and report "N approved" for a selection of N+k.
     Searching every page currently on the client removes the miss; the callers now throw on one
     anyway, so if it ever comes back it is reported instead of absorbed. */
  const findListing = useCallback((id) => [
    verifyQueue.page?.items, flaggedQueue.page?.items, featuredQueue.page?.items,
    staffQueue.page?.items, unconfirmedQueue.page?.items, allPage?.items, recheckAll, all,
  ].reduce((hit, rows) => hit || (rows || []).find((l) => l.id === id), undefined),
  [verifyQueue, flaggedQueue, featuredQueue, staffQueue, unconfirmedQueue, allPage, recheckAll, all]);

  /* `?review=<id>` opens the review modal. It resolves through `findListing`, which reads every
   * page currently on the client — all five queues plus the All page and the re-check list.
   *
   * Both narrower forms of this were wrong, in opposite directions. Resolving against `all` alone
   * meant one page of the catalogue ordered newest-first, so a link about a listing posted this
   * morning opened and one about a listing posted last month did not. Resolving against the pending
   * queue alone looks more principled — "a link asking someone to review a listing is asking about a
   * listing awaiting review" — and breaks the case the link exists for: a decision moves the listing
   * off that queue, so the modal could be opened once and never reopened, and the case file with its
   * communication log became unreachable the moment it was acted on. The union is not a compromise
   * between them; it is the set that answers "show me this listing's case file", which is the
   * question the link actually asks.
   *
   * A miss is now reported. The horizon is still the loaded pages, so a decided listing old enough
   * to have fallen off all of them cannot be resolved from the client — but the operator is told
   * that, instead of being dropped on a console that silently ignored the link they followed. */
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
  // There used to be a `logAudit(...)` line after each of these, writing a sentence into a
  // browser-local array. Every moderation call below now goes to the server, and every one of those
  // endpoints records its own audit row from the authenticated principal — the audit actions
  // property.status, property.featured, property.flag, property.archive and review.decide. (Written
  // unquoted on purpose: check-i18n-route-namespaces.mjs reads any quoted dotted literal as a
  // translation key, and would drag the 40 KB `property` namespace onto this route for a comment.)
  // The browser's copy
  // was a duplicate of a record it could not see, composed from the row the table happened to be
  // holding rather than from what the server actually did, and it survived a failed call in one
  // case and a partial bulk failure in three. Two audit trails that can disagree are worse than
  // one, and the one that cannot be tampered with from a console is the one to keep.
  //
  // `setPipelineStage` was the last exception and is no longer one (D27). It used to write to
  // `localStorage` because this console's funnel and the server's shared one field and disagreed
  // about what belonged in it: the read side was already the server's — `adminPipeline.pipelineStage`
  // through `propertyMapper` — while the write sent `under_review` and `live`, which the server's
  // enum did not contain and would have answered 400.
  //
  // V92 settled the disagreement by splitting the field rather than picking a winner. `pipeline_stage`
  // is the acquisition funnel the desk works (contacted → info collected → listed → docs submitted),
  // `handback_milestone` is the owner's half once the desk hands over (photos uploaded → Aadhaar
  // verified → claim sent → claimed), and the two no longer overwrite each other. `under_review` and
  // `live` turned out to belong to neither: they are `status` under another name — `pending` and
  // `approved` — so the board derives those two columns and nothing stores them.
  //
  // That is why the port removed writes rather than translating them. Approving a listing already
  // sets its status, so "and also move it to Live" was a second way to say the same thing that could
  // fail on its own; opening a review modal already means the listing is pending, so "and also mark
  // it Under Review" recorded nothing that was not already true. Both are gone. The one surviving
  // write is the board's own Select, below, and it goes to `POST /properties/{id}/pipeline`.
  // Resolves a selected id back to its row. It used to search `all` alone, which was survivable
  // only while every tab was a slice of `all`; now that each queue is its own fetch, a listing can
  // be selected on the verification tab and absent from `all` entirely — `all` is one page and the
  // pending queue is a different one. The callers below treated a miss as `return`, so the bulk
  // approve would skip the row, count it as neither done nor failed, and report "N approved" for a
  // selection of N+k. Searching every page currently on the client removes the miss; the callers
  // now throw on one anyway, so if it ever comes back it is reported instead of absorbed.
  // Every moderation call is awaited and every failure is surfaced. Against the API these are real
  // network writes that can 403 (self-dealing is refused server-side, so staff cannot moderate their
  // own listing), 404 or fail outright; the earlier fire-and-forget form produced an unhandled
  // rejection *and* a green success toast for the same click, which is worse than either alone.
  //
  // None of them reads the resolved value: the API returns no body for any moderation decision, so
  // the new state is derived from the row already on screen and confirmed by the `refresh()` below.
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
    // No pipeline write here. `clearFlag` sets the status to `approved` server-side, and the board's
    // Live column reads `status`, so the listing moves the moment the list refreshes. The
    // `setPipelineStage(l.id, 'live')` that used to sit on this line was an unawaited second write
    // of the same fact, which could fail silently under the success toast below.
    toast('Flag cleared — listing published', 'success');
    refresh();
  };
  /* ── Draining the stays-live re-check queue (Q14) ───────────────────────────────────────────
     Both outcomes are ordinary status transitions, deliberately: `PropertyModerationService`
     clears the re-check on *any* `setStatus`, which makes re-approving an already-approved listing
     the "checked it, all fine" action and means this queue needs no endpoint of its own. */
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
    /* One call. The server's decision writes the case file, `properties.status` and the
       "⛔ Your property could not be approved. Reason: …" message into the owner's thread in one
       transaction — a takedown an owner cannot see the reason for is one they cannot fix or
       appeal. This used to be `decideReview` *plus* `setListingStatus`, because the mock's case
       file and the mock's listing were unrelated records; keeping the second call would now write
       the same field twice, and the second write is the one that can silently disagree.

       `startPropertyReview` first because deciding requires a case file to exist (404 otherwise),
       and this queue holds listings that went live without ever being submitted for one. It is
       idempotent, so it is a no-op for the ones that have. */
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
  /* `bhkNum`, not the rendered `bhk`. The card label is "3 BHK" (and "" for a plot, because 0 is
     the catalogue's not-a-bedroom-count marker), and seeding the box with that string meant the
     value going back out was prose where the contract wants an integer. */
  const openEdit = (l) => { setEdit({ id: l.id, title: l.title || '', price: l.price ?? '', area: l.area ?? '', bhk: l.bhkNum ? String(l.bhkNum) : '', type: l.type || '', locality: l.locality || '', deal: l.deal || 'buy', status: l.status || 'pending', _ref: l }); };
  /**
   * Field edits and a status change are two different operations against the API — `ListingUpdate`
   * deliberately omits `status` so a PATCH cannot self-escalate — so a modal that changes both has
   * to make two calls. Sending them together used to look like it worked: the status simply
   * vanished from the request body and the dropdown silently did nothing.
   */
  const submitEdit = async () => {
    const title = edit.title.trim();
    const price = +edit.price;
    const area = edit.area === '' ? '' : +edit.area;
    const loc = edit.locality.trim();
    if (!title) return toast('Title is required', 'error');
    if (Number.isNaN(price) || price <= 0) return toast('Enter a valid price', 'error');
    if (area !== '' && (Number.isNaN(area) || area < 0)) return toast('Area must be a positive number', 'error');
    if (!loc) return toast('Locality is required', 'error');
    /* This field was sent as `bhk` and `toListingUpdate` reads `bhkNum`, so on live builds every
       BHK correction was deleted from the request body while the toast said it had saved. The cost
       was doubled because `bhk` is a *foundation* field: the listing kept the wrong configuration
       **and** never earned the re-review that changing one is supposed to trigger, so a 2BHK
       corrected to 3BHK went on being searchable under the wrong number indefinitely.

       Both names go out. `bhkNum` is what the wire mapper reads; `bhk` is the label the mock store
       renders straight from the patch. An empty box is omitted rather than sent as 0, because 0 is
       a real value here — the marker for plots and studios — and writing it on an untouched blank
       would silently reclassify a flat as having no bedrooms. An admin who means 0 can type it. */
    const bhkRaw = String(edit.bhk ?? '').trim();
    const bhkNum = bhkRaw === '' ? undefined : Number(bhkRaw);
    if (bhkNum !== undefined && (!Number.isInteger(bhkNum) || bhkNum < 0)) {
      return toast('Configuration must be a whole number of bedrooms', 'error');
    }
    const bhkPatch = bhkNum === undefined ? {} : { bhkNum, bhk: bhkNum ? `${bhkNum} BHK` : '' };
    try {
      /* The moderator route, not the owner's. This modal edits whatever listing the desk clicked,
         and `/me/listings/{id}` resolves owner-scoped — so against the API it answered 404 for
         every listing the moderator did not personally own, which is all of them. It passed in mock
         mode throughout, because the mock store has no owner to check. */
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

  /*
   * Chase an owner over WhatsApp.
   *
   * One helper behind both buttons, because they only ever differed in which template they picked.
   * What they used to do differed a great deal more:
   *
   *   "Send reminder"  called sendOwnerReminder, which incremented a counter in localStorage and
   *                    sent nothing at all. The toast said "Reminder sent to <owner>" and there was
   *                    no message, no record, and no way for the next person to find that out.
   *   "Confirm still
   *    available"      composed and opened wa.me in the browser, so the only trace was a mock audit
   *                    line. Two staff chasing the same owner could not see each other.
   *
   * `{id}` is parsed as a UUID and the list mapper sets `id` to `slug || id`, so live listings --
   * the ones with slugs -- are exactly the ones that would 404 on `l.id`.
   *
   * The tab is opened synchronously inside the click and navigated only once the server accepts:
   * opening it after the await loses it to popup blockers, and navigating it before would promise a
   * message the ledger has no row for. "Written", not "sent" -- click-to-chat hands the text to the
   * staff member's own WhatsApp and they may still edit it, or close the tab.
   */
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

  /* The board's Select. Awaited and error-branched like every other write on this page: against the
     API this is a network call that can 403 (the funnel needs post-on-behalf rights, which not every
     moderator has), 404, or refuse the value. The old form was fire-and-forget into localStorage and
     could not fail, so it had no error path to lose. */
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
  // `allSettled`, not `all`: a partial failure still applied to some listings, and reporting "12
  // approved" when 3 failed — or throwing away the 9 that succeeded — are both lies. Report what
  // actually happened and refresh either way, since the table is now out of date regardless.
  //
  // Partial failure is the expected case here, not a remote one: the server refuses self-dealing,
  // so a staff member selecting a page that includes one of their own listings gets a 403 for that
  // row and success for the rest.
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
      // Throw rather than return: `Promise.allSettled` counts a rejection, and a row nobody could
      // resolve is a row nobody approved. Returning quietly made it vanish from both halves of the
      // tally, so the toast reported a clean run over a selection it had only partly acted on.
      if (!l) throw new Error(`listing ${id} is no longer on this page`);
      await startPropertyReview(pid(l));
      await decidePropertyReview(pid(l), 'approve');
    }));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const done = results.length - failed;
    if (failed) toast(`${done} approved, ${failed} failed`, 'error');
    else toast(`${done} listing(s) approved`, 'success');
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

  /* Each tab waits for its own fetch, not for a shared one.
   *
   * The old form was `if (!all) return <Loading />` over the whole screen, which was honest while
   * every tab was a slice of `all` and is not any more. A tab whose queue has not answered yet must
   * not render its list, for the reason the re-check tab already documented below: "No listings
   * match your filters" is a claim about the catalogue, and a queue is not entitled to make it
   * while its own request is still in flight. Getting this wrong does not look like a bug — it
   * looks like an empty queue, which is the outcome everybody is hoping for. */
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

  /* Whether the rows on screen still answer the term in the box, per tab.
   *
   * Looked up from `activeTab` rather than threaded through `renderListTab`, which already takes
   * ten positional arguments; every call to it sits inside its own tab's branch, so the active tab
   * *is* the queue being rendered. Re-check and Pipeline are absent because neither has a server
   * `q` — `qRecheck` still narrows its own fetched rows client-side and so is never out of step. */
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

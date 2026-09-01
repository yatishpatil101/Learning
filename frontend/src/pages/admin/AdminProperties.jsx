import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Archive, ArrowUpRight, Building2, Check, CheckCircle2, ClipboardCheck, Clock, Copy, Download, Flag, Star, X } from 'lucide-react';
import { listForModeration, setListingStatus, toggleFeatured, flagListing, clearFlag, setPipelineStage, updateListingAsModerator, archiveListing, restoreListing } from '../../services/propertyService.js';
import { chaseOwner } from '../../services/outreachService.js';
import { startPropertyReview, decidePropertyReview } from '../../services/propertyReviewService.js';
import { findDuplicateClusters } from '../../lib/data/properties-admin.js';
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

function KpiCard({ label, value, icon: Icon, tint, onClick }) {
  return (
    <button type="button" onClick={onClick} title={`View ${label} listings`} className="group pn-card p-4 sm:p-5 text-left transition hover:border-brand-teal/40 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand-teal/40">
      <div className="flex items-start justify-between">
        <span className={classNames('grid h-10 w-10 place-items-center rounded-xl', KPI_TINTS[tint])}><Icon className="h-5 w-5" /></span>
        <ArrowUpRight className="h-4 w-4 text-gray-500 transition group-hover:text-brand-teal" />
      </div>
      <div className="mt-3 text-2xl font-extrabold">{fmtNum(value)}</div>
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
  const [tab, setTab] = useTabParam(['all', 'pipeline', 'verify', 'followup', 'staff', 'flagged', 'recheck', 'featured', 'duplicates'], 'all');

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
     moderation endpoint pages at 20. Filtering client-side would therefore quietly show the
     re-checks that happen to fall in the newest 20 listings and silently drop the rest, which for a
     queue is worse than showing nothing: it looks drained. `?recheck=true` asks the server the
     actual question, and the mock answers it identically.

     `DuplicatesTab` already establishes a tab with its own data source.

     `archived: false` is sent explicitly rather than left to the outcome's definition. Archiving
     does not call `clearRecheck()`, and `adminSearch` adds no archived predicate when the filter is
     null, so a listing archived while a re-check was outstanding still matches `recheck=true`
     server-side. The mock drops archived rows unconditionally, so without this the two sides would
     disagree — and the live queue would carry rows that no longer need reviewing. */
  const [recheckAll, setRecheckAll] = useState(null);

  const refresh = () => Promise.all([
    listForModeration({}, 'newest').then(setAll),
    fetchRecheckQueue(reportRecheckLoadError).then(setRecheckAll),
  ]);

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

  // Deep-link handling — ?tab= is resolved by useTabParam; here we only open a review modal.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!all || deepLinkHandled.current) return;
    const reviewId = params.get('review');
    if (reviewId) {
      const listing = all.find((l) => l.id === reviewId);
      if (listing) { setTab('verify'); setReview(listing); }
    }
    deepLinkHandled.current = true;
  }, [all, params]);

  const jumpTo = (t, status) => { setTab(t); if (t === 'all') { setQAll(''); setFDeal(''); setFStatus(status || ''); } };

  // ---- computed data ----
  const counts = useMemo(() => {
    const list = all || [];
    const c = { total: 0, approved: 0, pending: 0, flagged: 0, featured: 0 };
    list.forEach((l) => { if (l.archived) return; c.total++; if (l.status === 'approved') c.approved++; if (l.status === 'pending' || l.status === 'Under Review') c.pending++; if (l.status === 'flagged') c.flagged++; if (l.featured) c.featured++; });
    return c;
  }, [all]);

  // Number of distinct duplicate clusters awaiting an Ops merge decision.
  const dupCount = useMemo(() => findDuplicateClusters().length, [all]);

  /* Surfaced in the tab label and as a KPI. A re-check that nobody is *told about* is the same as
     no re-check at all, and this queue has no other way of announcing itself: the listings in it
     are live, approved and un-archived, so they raise none of the existing counters. */
  const recheckCount = (recheckAll || []).length;

  const rowsAll = useMemo(() => {
    const list = all || [];
    const q = qAll.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => {
      if (q && !(l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) return false;
      if (fStatus === 'archived') {
        if (!l.archived) return false;
      } else {
        if (l.archived) return false;
        if (fStatus && l.status !== fStatus) return false;
      }
      if (cutoff && new Date(l.createdAt).getTime() < cutoff) return false;
      if (fDeal && l.deal !== fDeal) return false;
      if (fQuality && qualityLabel(computeQualityScore(l)) !== fQuality) return false;
      return true;
    });
  }, [all, qAll, fStatus, fDeal, dateRange, fQuality]);

  const rowsVerify = useMemo(() => {
    const list = all || [];
    const q = qVerify.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => (l.status === 'pending' || l.status === 'Under Review') && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qVerify, dateRange, fDeal]);

  const rowsFlagged = useMemo(() => {
    const list = all || [];
    const q = qFlagged.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => l.status === 'flagged' && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qFlagged, dateRange, fDeal]);

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
    const list = all || [];
    const q = qFeatured.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => l.featured && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.locality + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qFeatured, dateRange, fDeal]);

  const rowsStaff = useMemo(() => {
    const list = all || [];
    const q = qStaff.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => l.postedByStaff && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.owner + l.locality + l.postedByStaff + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qStaff, dateRange, fDeal]);

  const { rowsFollowUp, rowsStale, rowsAwaiting } = useMemo(() => {
    const list = all || [];
    const now = Date.now();
    const q = qFollowUp.toLowerCase();
    const stale = [];
    const awaiting = [];
    list.forEach((l) => {
      if (l.status !== 'pending' && l.status !== 'Under Review') return;
      if (fDeal && l.deal !== fDeal) return;
      if (q && !(l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) return;
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
  }, [all, qFollowUp, fDeal]);

  const rowsUnconfirmed = useMemo(() => {
    const list = all || [];
    const q = qFollowUp.toLowerCase();
    return list
      .filter((l) => {
        if (!l.real || l.archived || l.status !== 'approved') return false;
        const st = freshnessState(l);
        if (st !== 'stale' && st !== 'dormant') return false;
        if (fDeal && l.deal !== fDeal) return false;
        if (q && !(l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => new Date(a.freshenedAt || a.createdAt) - new Date(b.freshenedAt || b.createdAt));
  }, [all, qFollowUp, fDeal]);

  const activeFollowUp =
    followUpSub === 'unconfirmed' ? rowsUnconfirmed :
    followUpSub === 'stale' ? rowsStale :
    followUpSub === 'awaiting' ? rowsAwaiting :
    rowsFollowUp;

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
  const findListing = (id) => (all || []).find((l) => l.id === id);

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
      if (!l) return;
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
      if (!l) return;
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
    if (activeTab === 'verify') exportCsv('punenest-verification-queue.csv', ['ID', 'Title', 'BHK', 'Type', 'Locality', 'Price', 'Owner', 'Mobile', 'Submitted'], rowsVerify.map((l) => [l.id, l.title, l.bhk, l.type, l.locality, l.price, l.owner, l.ownerMobile, l.createdAt]));
    else if (activeTab === 'flagged') exportCsv('punenest-flagged.csv', ['ID', 'Title', 'Locality', 'Price', 'Owner', 'Reason'], rowsFlagged.map((l) => [l.id, l.title, l.locality, l.price, l.owner, l.flagReason || 'Flagged']));
    else if (activeTab === 'recheck') exportCsv('punenest-recheck-queue.csv', ['ID', 'Title', 'Locality', 'Price', 'Owner', 'Changed fields', 'Queued at', 'Waiting'], rowsRecheck.map((l) => [l.id, l.title, l.locality, l.price, l.owner, l.recheckReason || '', l.recheckRequestedAt || '', fmtAgo(l.recheckRequestedAt)]));
    else if (activeTab === 'featured') exportCsv('punenest-featured.csv', ['ID', 'Title', 'Locality', 'Price', 'Views', 'Enquiries'], rowsFeatured.map((l) => [l.id, l.title, l.locality, l.price, l.views, l.enquiries]));
    else exportCsv('punenest-listings.csv', ['ID', 'Title', 'BHK', 'Type', 'Locality', 'Price', 'Owner', 'Mobile', 'Views', 'Enquiries', 'Deal', 'Status', 'Featured'], rowsAll.map((l) => [l.id, l.title, l.bhk, l.type, l.locality, l.price, l.owner, l.ownerMobile, l.views, l.enquiries, l.deal, l.status, l.featured ? 'Yes' : 'No']));
  };

  if (!all) return <Loading />;
  /* The two fetches are independent, so `all` can land first. On a deep link to `?tab=recheck`
     that would render the banner over "No listings match your filters" with a count-less tab —
     a queue confidently reporting itself drained while its own fetch is still in flight. */
  if (activeTab === 'recheck' && !recheckAll) return <Loading />;

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

  const renderListTab = (rows, query, setQuery, placeholder, countLabel, extraFilters, cardActions, selectable, selected, onSelect) => (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="pn-input sm:w-72" />
        {extraFilters}
        <DealPills value={fDeal} onChange={setFDeal} />
        <DateRangePills value={dateRange} onChange={setDateRange} />
        <span className="ml-auto text-sm text-gray-400">{rows.length} {countLabel}</span>
      </div>
      {rows.length === 0 ? (
        <p className="pn-card p-8 text-center text-gray-500">No listings match your filters</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, PAGE_LIMIT).map((l) => (
            <AdminPropertyCard key={l.id} listing={l} selectable={selectable} selected={selected?.(l.id)} onSelect={onSelect} showQualityScore={optionEnabled('properties.qualityScore')} actions={cardActions} />
          ))}
          <PaginationHint total={rows.length} />
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="Properties" subtitle={verifyOnly ? 'Review, verify and approve every listing before it goes live' : 'Manage, verify and curate every listing'} actions={optionEnabled('properties.csvExport') ? <button onClick={exportCurrentCsv} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" /> Export CSV</button> : null} />

      {/* KPI cards */}
      {!verifyOnly && (
      <div className="mb-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <KpiCard label="Total" value={counts.total} icon={Building2} tint="indigo" onClick={() => jumpTo('all', '')} />
        <KpiCard label="Active" value={counts.approved} icon={CheckCircle2} tint="emerald" onClick={() => jumpTo('all', 'approved')} />
        <KpiCard label="Pending" value={counts.pending} icon={Clock} tint="amber" onClick={() => jumpTo('verify', '')} />
        <KpiCard label="Flagged" value={counts.flagged} icon={Flag} tint="rose" onClick={() => jumpTo('flagged', '')} />
        <KpiCard label="Re-check" value={recheckCount} icon={ClipboardCheck} tint="amber" onClick={() => setTab('recheck')} />
        <KpiCard label="Duplicate" value={dupCount} icon={Copy} tint="rose" onClick={() => setTab('duplicates')} />
        <KpiCard label="Featured" value={counts.featured} icon={Star} tint="teal" onClick={() => jumpTo('featured', '')} />
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
              <button onClick={bulkFeature} className="pn-btn pn-btn-ghost pn-btn-sm"><Star className="h-4 w-4" /> Toggle featured</button>
              <button onClick={bulkArchive} className="pn-btn pn-btn-danger pn-btn-sm"><Archive className="h-4 w-4" /> Archive selected</button>
            </div>
          ) : null}
          {renderListTab(rowsAll, qAll, setQAll, 'Search title, owner, locality\u2026', `of ${(all || []).length} listings`,
            <><Select value={fStatus} onChange={setFStatus} options={STATUS_OPTS} className="sm:w-44" ariaLabel="Filter by status" />{optionEnabled('properties.qualityScore') && <QualityPills value={fQuality} onChange={setFQuality} />}</>,
            actions, optionEnabled('properties.bulkOps'), (id) => selAll.has(id), toggleOneAll)}
        </>
      )}

      {activeTab === 'verify' && (
        <>
          {optionEnabled('properties.bulkOps') && selVerIds.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="font-semibold">{selVerIds.length} selected</span><div className="flex-1" />
              <button onClick={bulkApprove} className="pn-btn pn-btn-success pn-btn-sm"><Check className="h-4 w-4" /> Approve selected</button>
              <button onClick={() => setBulkRejectOpen(true)} className="pn-btn pn-btn-danger pn-btn-sm"><X className="h-4 w-4" /> Reject selected</button>
            </div>
          ) : null}
          {renderListTab(rowsVerify, qVerify, setQVerify, 'Search title, owner, locality\u2026', 'pending', null,
            { onView: setView, onEdit: openEdit, onReview: openReview, onFlag: openFlag, onArchive: doArchive }, optionEnabled('properties.bulkOps'), (id) => selVer.has(id), toggleOneVer)}
        </>
      )}

      {activeTab === 'flagged' && renderListTab(rowsFlagged, qFlagged, setQFlagged, 'Search title, owner, locality\u2026', 'flagged', null, { onView: setView, onEdit: openEdit, onClearFlag: doClearFlag, onArchive: doArchive })}

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
          {recheckCount >= 100 && (
            <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100" data-testid="recheck-truncated">
              <span className="font-semibold">More than 100 re-checks are queued.</span>{' '}
              Only the most recent 100 are shown, so the oldest — the ones most overdue — are not on
              this page. Clear the backlog, or narrow with the filters above.
            </div>
          )}
          {renderListTab(rowsRecheck, qRecheck, setQRecheck, 'Search title, owner, locality\u2026', 'awaiting re-check', null,
            { onView: setView, onEdit: openEdit, onRecheckPass: doRecheckPass, onRecheckFail: openRecheckReject, onFlag: openFlag, onArchive: doArchive })}
        </>
      )}
      {activeTab === 'featured' && renderListTab(rowsFeatured, qFeatured, setQFeatured, 'Search title, locality\u2026', 'featured', null, { onView: setView, onEdit: openEdit, onFeature: doFeature, onFlag: openFlag, onArchive: doArchive })}
      {activeTab === 'staff' && renderListTab(rowsStaff, qStaff, setQStaff, 'Search title, owner, staff name\u2026', 'staff-posted', null, { onView: setView, onEdit: openEdit, onReview: openReview, onArchive: doArchive })}

      {activeTab === 'followup' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input value={qFollowUp} onChange={(e) => setQFollowUp(e.target.value)} placeholder={'Search title, owner, locality\u2026'} className="pn-input sm:w-72" />
            <Select value={followUpSub} onChange={setFollowUpSub} options={[{ value: 'all', label: 'All reasons' }, { value: 'stale', label: 'Stale pending' }, { value: 'awaiting', label: 'Awaiting owner' }, { value: 'unconfirmed', label: 'Unconfirmed (stale)' }]} className="sm:w-48" ariaLabel="Filter by reason" />
            <DealPills value={fDeal} onChange={setFDeal} />
            <DateRangePills value={dateRange} onChange={setDateRange} />
            <span className="ml-auto text-sm text-gray-400">{activeFollowUp.length} listings</span>
          </div>
          {followUpSub === 'unconfirmed' && (
            <p className="pn-card px-4 py-3 mb-3 text-xs text-gray-400 flex items-start gap-2">
              <Clock className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
              <span>Live listings whose owners haven't confirmed availability in over {30} days. Send a WhatsApp nudge so buyers keep seeing fresh, trustworthy listings.</span>
            </p>
          )}
          {activeFollowUp.length === 0 ? (
            <p className="pn-card p-8 text-center text-gray-500">All caught up — no listings need follow-up right now.</p>
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
        </div>
      )}

      {activeTab === 'pipeline' && <PipelineTab all={all} onAdvancePipeline={advancePipeline} />}

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

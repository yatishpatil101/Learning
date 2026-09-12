import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ShieldCheck, Home, BadgeCheck, Check, GitMerge, Sparkles, Flag } from 'lucide-react';
import { fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import { useSocietySearch } from '../../lib/useSocietySearch.js';
import {
  listSocietyClaimQueue, decideSocietyClaim, getSocietyClaimCertificate,
  listSocietyProposalQueue, decideSocietyProposal,
  listSocietyResidentQueue, decideResidency,
  listSocietyCandidates, verifySocietyCandidate, listSocietyCandidateDuplicates,
  listSocietyMerges, mergeSocieties, undoSocietyMerge,
  getSocietyAdminView, editSociety, listSocietyDirectory,
} from '../../services/societyService.js';
import { listReports, triageReport } from '../../services/reportService.js';
import { ApiError, NetworkError } from '../../services/http.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { titleCase, fmtDate, Chip, DUPES_FAILED } from './societies/helpers.jsx';
import ClaimsTab from './societies/ClaimsTab.jsx';
import ResidentsTab from './societies/ResidentsTab.jsx';
import CandidatesTab from './societies/CandidatesTab.jsx';
import DirectoryTab from './societies/DirectoryTab.jsx';
import ModerationTab from './societies/ModerationTab.jsx';

/**
 * The five society UGC surfaces, as the report queue's view model names them.
 *
 * `review` is deliberately absent. A society review is reported as an ordinary `review` and taken
 * down through `PATCH /reviews/{id}/status`, so nothing on the wire says whether a given review
 * report is about a society or about a listing — including them here would drag every property
 * review complaint into the societies console. They stay in Admin ▸ Reports, which handles every
 * kind. The browser-only queue could tell them apart because it stored a slug on every row; the
 * contract does not, and inventing the distinction client-side would get it wrong silently.
 */
const SOCIETY_REPORT_KINDS = new Set(['contribution', 'reply', 'question', 'answer', 'board']);

/** Statuses a moderator can still act on. `actioned` and `dismissed` are terminal server-side. */
const LIVE_REPORT_STATUSES = new Set(['open', 'reviewing']);

/* 20, matching `GET /societies`'s own `@PageableDefault`. The other server-paged desks in this shell
   use 25 because they inherited it from the flatmate boards; this one has no such history, so it
   takes the server's number and asking for a page becomes a request with nothing to disagree about. */
const DIR_PAGE_SIZE = 20;

/**
 * A `details` proposal, dressed as the shape the candidates tab and the review dialog render.
 *
 * The wire is flat (`builder`, `buildYear`, …) where the old store nested everything under
 * `fields`. The society's name and locality now travel on the proposal itself — a small
 * denormalisation the server does deliberately, because the alternative is what this function used
 * to do: resolve them out of the bundled catalogue, which held 28 curated societies and none of the
 * member-added ones. A proposal against a society added last week rendered as a title-cased slug.
 */
const toSuggestionRow = (p) => ({
  id: p.id,
  slug: p.societySlug,
  name: p.societyName || titleCase(p.societySlug),
  localitySlug: p.localitySlug || '',
  at: p.createdAt,
  by: p.authorName || '',
  fields: {
    builder: p.builder,
    // The wire says `buildYear`; the dialog and the society column both say `year`.
    year: p.buildYear,
    towers: p.towers,
    units: p.units,
    maintenancePerSqft: p.maintenancePerSqft,
    amenities: p.amenities,
  },
});

export default function AdminSocieties() {
  const { toast } = useToast();
  /* No `by` here any more. Every decision on this console used to pass the signed-in operator's
     display name to a store function that stamped it onto a localStorage row — which meant the
     record of who verified a society was a self-reported string in the browser of the person
     claiming it. The server takes the actor from the authenticated principal and never from the
     request body, so there is nothing left to pass. */
  const [tab, setTab] = useTabParam(['claims', 'residents', 'candidates', 'directory', 'moderation'], 'claims');
  const [claims, setClaims] = useState([]);
  const [residents, setResidents] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [merges, setMerges] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [reports, setReports] = useState([]);
  const [waPending, setWaPending] = useState([]);
  const [locFixes, setLocFixes] = useState([]);
  /* Which queues did not load. An empty table on an ops screen reads as "nothing to do", so a
     failed fetch and a drained queue are indistinguishable without this — and the failure mode is
     that moderation quietly stops and nobody notices. */
  const [queueErrors, setQueueErrors] = useState([]);
  const [bump, setBump] = useState(0);
  const [edit, setEdit] = useState(null); // { slug, ...form }
  const [merge, setMerge] = useState(null); // { cand, target, query }
  /* The merge dialog's own in-flight flag, not a member of `deciding`. That Set is keyed by row id
     and drives the per-row buttons; this guards one modal button, which is only ever pressed once
     at a time and would have no row to key on if it were. */
  const [merging, setMerging] = useState(false);
  const [review, setReview] = useState(null); // pending suggestion under review

  /* Every queue on this console now reads the API. `reload` is one async statement again, and the
     split synchronous path that used to run first — the candidates queue, read straight out of
     localStorage — is gone with the last of the browser-local ops state.

     `reloadSeq` is what stops a slow reload overwriting a fast one. Every decision below bumps
     `bump`, which re-fires the effect, so two reloads are routinely in flight at once — the first
     one carrying the pre-decision queue. Without the guard, whichever *response* landed last won,
     and the row an operator just approved would reappear as pending often enough to look like the
     write had failed. Only the newest request is allowed to call `setState`. */
  const reloadSeq = useRef(0);

  const reload = async () => {
    const seq = reloadSeq.current + 1;
    reloadSeq.current = seq;
    /* Per-queue, not one `Promise.all` rejection: a 500 on reports must not blank the claims tab.
       Only transport failures are absorbed. A TypeError from a mapper change would otherwise
       arrive as an empty queue, and on this screen an empty queue renders as "nothing to
       moderate" — the most reassuring possible face for a bug. Those rethrow. */
    const broke = [];
    const safe = (p, label, empty) => p.catch((err) => {
      if (!(err instanceof ApiError || err instanceof NetworkError)) throw err;
      console.warn(`[societies] The ${label} queue could not be loaded.`, err);
      broke.push(label);
      return empty;
    });
    /* Every queue asks the server for just the live rows. Unfiltered, decided rows accumulate
       forever and fill the 100-row page budget oldest-first, so the newly-filed work falls off
       the end: the queue would read empty precisely as the backlog grew. `listReports` takes one
       status, and triage has two live ones. */
    const [claimRows, proposals, residentRows, candidateRows, mergeRows, openReports, reviewingReports] = await Promise.all([
      safe(listSocietyClaimQueue({ status: 'pending' }), 'claims', []),
      safe(listSocietyProposalQueue({ status: 'pending' }), 'community proposal', []),
      /* Unfiltered, unlike its neighbours. A residency is the one decision on this console that is
         routinely revisited — a flat changes hands, and rejecting the outgoing resident is how the
         incoming one gets verified — so an operator has to be able to find the verified row to
         reject it. Asking only for `pending` would hide exactly the row they came for. */
      safe(listSocietyResidentQueue(), 'resident verification', []),
      /* No status filter to pass: the route *is* the filter. A candidate is a community-minted
         society with no verification stamp, so verifying one is what takes it off this list —
         there is no decided-candidate row to accumulate and crowd out the new work. */
      safe(listSocietyCandidates(), 'society candidates', []),
      safe(listSocietyMerges(), 'merges', []),
      safe(listReports({ status: 'open' }), 'reports', { items: [] }),
      safe(listReports({ status: 'reviewing' }), 'reports', { items: [] }),
    ]);
    if (seq !== reloadSeq.current) return; // a newer reload has already answered

    // Both report reads carry the same label, so a double failure would otherwise render as
    // "The reports and reports queues could not be loaded" — a disclosure banner that looks broken.
    setQueueErrors([...new Set(broke)]);
    setClaims(claimRows);
    setResidents(residentRows);
    setCandidates(candidateRows);
    setMerges(mergeRows);
    /* The three "pending" lists this console used to read from three localStorage keys are one
       resource with a `kind` column — `details`, `whatsapp`, `location`. One request, grouped
       here. That collapse is the single most surprising thing about this migration: there is no
       third queue to forget to drain, and a proposal cannot exist in two of them. */
    setSuggestions(proposals.filter((p) => p.kind === 'details').map(toSuggestionRow));
    setWaPending(proposals.filter((p) => p.kind === 'whatsapp'));
    setLocFixes(proposals.filter((p) => p.kind === 'location'));
    setReports([...(openReports.items || []), ...(reviewingReports.items || [])].filter(
      (r) => SOCIETY_REPORT_KINDS.has(r.kind) && LIVE_REPORT_STATUSES.has(r.status),
    ));
  };
  /* Keyed on `bump` alone now. `catalogueReady` used to be a second dependency because the duplicate
     hint below was computed from the bundled catalogue and had to wait for it to load; the hint is
     served, so the bundled catalogue is no longer read on this screen at all. */
  useEffect(() => { reload(); }, [bump]); // eslint-disable-line react-hooks/exhaustive-deps -- `reload` is redeclared every render; `bump` is the real input.

  /* The directory is a real server page (D129 closes here).

     It used to be `allSocieties().map(resolveSociety)` — the bundled catalogue, every row of it, cut
     into tens by `Table`'s client-side pager. That pager was a lie about network cost the moment the
     rows started coming from Postgres, and `api-standards.md` §5 names it: "a client-side pager is a
     smell, not a solution... if a screen needs a pager, the endpoint feeding it needs PageEnvelope".

     It reads `GET /societies` rather than an `/admin/societies` of its own, which is the call
     `Routes.AdminSocieties` argues for in the backend: every column below is already on
     `SocietyResponse`, and a second listing route would be a second set of filters to keep in step
     with this one. The visible consequence is that a merged-away society no longer appears here —
     correct, since a merged society is not a building an operator should be editing.

     `dirQuery` is debounced into `dirSearch` because this is now a request per keystroke otherwise.
     Both live here rather than inside `DirectoryTab` so that resetting to page 0 on a new search is
     one statement instead of a callback contract between the two. */
  const [dirQuery, setDirQuery] = useState('');
  const [dirSearch, setDirSearch] = useState('');
  const [dirPage, setDirPage] = useState(0);
  const [dir, setDir] = useState({ status: 'loading', items: [], total: 0 });

  useEffect(() => {
    const t = setTimeout(() => { setDirSearch(dirQuery.trim()); setDirPage(0); }, 250);
    return () => clearTimeout(t);
  }, [dirQuery]);

  useEffect(() => {
    let alive = true;
    setDir((d) => ({ ...d, status: 'loading' }));
    listSocietyDirectory({ q: dirSearch, page: dirPage, size: DIR_PAGE_SIZE })
      .then((res) => { if (alive) setDir({ status: 'ready', items: res.items, total: res.total }); })
      /* Never an empty list on failure. "No societies" and "we could not read the directory" are
         different sentences and only one of them is ever true; the first is the more reassuring
         face for a bug, which is why it must not be the one a broken read wears. */
      .catch(() => { if (alive) setDir({ status: 'error', items: [], total: 0 }); });
    return () => { alive = false; };
  }, [dirSearch, dirPage, bump]);

  /* The duplicate hint, served (D252).
     It was computed here, from the bundled catalogue the page loaded beside the directory. That
     catalogue is 28 curated societies compiled into the app. Every duplicate this queue actually
     produces is a member-added row — that is what a candidate *is* — and not one of those was in
     the file, so a candidate that was a textbook second copy of another candidate rendered "No
     obvious match". The operator reads that as "no duplicate exists" and verifies the junk row into
     a permanent one, at which point nothing automatic can undo it. The scan has to run where the
     catalogue is.

     It is still a hint and not a claim, and the column still says so. Nothing here decides anything:
     the chip opens the merge dialog with that society pre-picked, and the operator can change it,
     search for another, or ignore every chip. What the hint buys is that the obvious duplicate is
     one click away instead of one search away — the difference between an operator merging it and
     an operator verifying it because merging looked like work.

     Fetched only while the candidates tab is open, because this is now a request per row rather
     than a memo, and four at a time rather than all at once: a backlog of eighty candidates would
     otherwise open eighty sockets the instant an operator clicked the tab, and the browser would
     queue them behind each other anyway while starving the merge picker's type-ahead. */
  const [dupes, setDupes] = useState({});

  useEffect(() => {
    if (tab !== 'candidates' || !candidates.length) return undefined;
    let alive = true;
    const queue = candidates.map((c) => c.slug).filter(Boolean);

    /* Kept for rows still in the queue, dropped for rows that have left it. Every slug here is
       about to be re-fetched, so holding the previous answer is what stops the whole column
       flickering back to "Checking…" after each single verify — but a slug the operator has
       already dealt with is never coming back on screen, and its entry would otherwise sit in this
       map for as long as the console stayed open. */
    const wanted = new Set(queue);
    setDupes((prev) => Object.fromEntries(
      Object.entries(prev).filter(([slug]) => wanted.has(slug))));

    const worker = async () => {
      for (let slug = queue.shift(); slug && alive; slug = queue.shift()) {
        /* Per-slug, and a failure says so rather than leaving the row loading forever or claiming
           the catalogue came back empty. The column has a state for each of the four things that
           can be true — still checking, nothing found, here they are, and the check did not
           answer — because the collapse that matters is a failed request wearing "No obvious
           match", which is the sentence an operator reads as "safe to verify". */
        try {
          const rows = await listSocietyCandidateDuplicates(slug);
          if (alive) setDupes((prev) => ({ ...prev, [slug]: rows }));
        } catch (err) {
          console.warn(`[societies] Could not check ${slug} for duplicates.`, err);
          if (alive) setDupes((prev) => ({ ...prev, [slug]: DUPES_FAILED }));
        }
      }
    };

    Promise.all([worker(), worker(), worker(), worker()]);
    return () => { alive = false; };
  }, [tab, candidates]);

  const candidateRows = candidates.map((c) => ({ ...c, dupes: dupes[c.slug] }));

  const pendingClaims = claims.filter((c) => c.status === 'pending').length;
  const pendingRes = residents.filter((r) => r.status === 'pending').length;

  /* Ten `logAudit('Societies', …)` calls stood one line below each of the ten decisions in this
     block — claim, resident, report, WhatsApp, location, verify, merge, apply, dismiss, edit. They
     are gone, and the reason is not that the audit question was answered.

     `logAudit` unshifted a sentence onto `db.auditLog` in this browser's localStorage, capped at
     200 rows. Exactly one screen ever read that array: Admin ▸ Settings ▸ Audit log. Every write
     underneath these ten lines goes to `lib/store/societyAdmin.js`, which uses its own `dzSociety*`
     keys and never reaches the server — so these rows described changes no other operator could
     see, in a log no other operator could read.

     The register item that owns the audit *reader* (18) is still open, and this does not touch it:
     the server's `/admin/audit-log` is read-only by construction and `AuditService.record` is
     server-internal, so these ten sentences were never going to appear there no matter how item 18
     is decided. The same deletion was already made in `AdminFlagsContext`, `AdminContent`,
     `AdminProperties`, `AdminReports` and `AdminPostOnBehalf`. The honest cost is ten sentences
     that stopped appearing in one browser's Audit tab. */

  /* Every decision below bumps `bump` and nothing else. It used to call `reload()` *and* bump,
     which was harmless while the reload was a synchronous localStorage read; now it would fire two
     overlapping rounds of requests where the effect already fires one. */
  const failed = (err, fallback) => toast(err?.message || fallback, 'error');

  /* Ids with a decision in flight. The Approve/Reject buttons stay mounted for the whole PATCH
     plus the reload behind it, and a decided row now answers 409 — so an impatient second click
     would answer the first click's success with "could not record that decision", which reads as
     though the approval failed. A Set rather than a boolean because several rows are actionable
     at once and one operator's click must not grey out the rest of the queue. */
  const [deciding, setDeciding] = useState(() => new Set());
  /* The state Set cannot be the guard: it is the value captured at render, so two clicks inside one
     frame both read the empty one and both fire the PATCH — the second answering the first's
     success with a 409. This ref is checked and updated synchronously, so it closes before the
     paint does; `deciding` above stays purely what the buttons render from. */
  const decidingRef = useRef(new Set());
  const withDeciding = async (id, run) => {
    if (decidingRef.current.has(id)) return;
    decidingRef.current.add(id);
    setDeciding((prev) => new Set(prev).add(id));
    try {
      await run();
    } finally {
      decidingRef.current.delete(id);
      setDeciding((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const decideClaim = (id, status) => withDeciding(id, async () => {
    try {
      // By claim id, not by society slug: the server keeps every claim ever filed, so a slug names
      // a society rather than a decision.
      await decideSocietyClaim(id, { status });
    } catch (err) { failed(err, 'Could not record that decision.'); return; }
    setBump((n) => n + 1);
    toast(status === 'approved' ? 'Society claim approved' : 'Claim rejected', status === 'approved' ? 'success' : 'info');
  });

  /* Ids whose certificate is being fetched. Same Set-plus-ref shape as `deciding` and for the same
     reason, but kept separate: opening the proof is not deciding, and sharing the Set would grey
     out Approve/Reject while a link is being minted. */
  const [opening, setOpening] = useState(() => new Set());
  const openingRef = useRef(new Set());
  /**
   * Fetch a signed link for one claim's certificate and hand it to the browser.
   *
   * **On click, never on load.** The queue pages at twenty; the link is a live, expiring capability
   * on a document in somebody's personal vault, and most rows are never opened. Requesting one per
   * row would mint twenty of them per page view, put nineteen unused capabilities into a cached
   * response, and write nineteen spurious rows into the server's reveal audit. So the queue read
   * stays exactly as it was and this runs once, for the certificate a human asked to see.
   *
   * `noopener` because the URL is a capability: without it the opened tab keeps a handle on this
   * one through `window.opener`, and the document being opened is a stranger's paperwork.
   */
  const viewCertificate = async (id) => {
    if (openingRef.current.has(id)) return;
    openingRef.current.add(id);
    setOpening((prev) => new Set(prev).add(id));
    try {
      const cert = await getSocietyClaimCertificate(id);
      if (!cert?.url) {
        // Dev has no signed-URL provider configured, and the mock keeps only metadata for a large
        // file. Say so rather than opening `about:blank`, which reads as a broken button.
        toast('That certificate is stored but cannot be opened in this environment.', 'info');
        return;
      }
      window.open(cert.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      failed(err, 'Could not open that certificate.');
    } finally {
      openingRef.current.delete(id);
      setOpening((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };
  /* Decided by the slug the row carries, not by a route of its own. The per-society PATCH already
     admits staff and already owns the one-verified-resident-per-flat rule; a second path to that
     rule would be a second copy of it, and the copy ops exercises rather than the committee is the
     one that drifts. The 409 is that rule firing — a real answer, not a transport failure — so it
     is surfaced with the server's own words. */
  const decideResident = (r, status) => withDeciding(r.id, async () => {
    try {
      await decideResidency(r.societySlug, r.id, { status });
    } catch (err) {
      failed(err, 'Could not record that decision.');
      return;
    }
    setBump((n) => n + 1);
    toast(status === 'verified' ? 'Resident verified' : 'Resident request rejected', status === 'verified' ? 'success' : 'info');
  });

  const decideReport = (r, action) => withDeciding(r.id, async () => {
    try {
      /* "Remove content" is two facts on the wire, not one: the complaint is `actioned` *and* the
         enforcement that discharges it is `hide_content`. Sending the status alone would close the
         report and leave the post up — which is exactly what the old queue's buttons did. */
      await triageReport(r.id, action === 'remove'
        ? { status: 'actioned', enforcement: 'hide_content' }
        : { status: 'dismissed' });
    } catch (err) { failed(err, 'Could not triage that report.'); return; }
    setBump((n) => n + 1);
    toast(action === 'remove' ? 'Content removed & report closed' : 'Report dismissed — content kept', action === 'remove' ? 'success' : 'info');
  });
  const decideProposal = (p, status, message, tone) => withDeciding(p.id, async () => {
    try {
      await decideSocietyProposal(p.id, { status });
    } catch (err) { failed(err, 'Could not record that decision.'); return; }
    setBump((n) => n + 1);
    toast(message, tone);
  });
  const decideWa = (w, action) => decideProposal(
    w,
    action === 'approve' ? 'approved' : 'rejected',
    action === 'approve' ? 'WhatsApp link approved — now live on the hub' : 'WhatsApp link rejected',
    action === 'approve' ? 'success' : 'info',
  );
  const decideLoc = (l, action) => decideProposal(
    l,
    action === 'approve' ? 'approved' : 'rejected',
    action === 'approve' ? 'Location approved — the society map now uses this pin' : 'Location fix rejected',
    action === 'approve' ? 'success' : 'info',
  );

  /* Keyed on the slug, not on an id: a candidate is a society, and the queue row has no identity of
     its own to guard. The 409 the server answers when somebody else has already verified it is a
     real answer and is surfaced with the server's own words — it names who confirmed it, which is
     the only thing that says who to ask about the society later. */
  const verifyCand = (s) => withDeciding(s.slug, async () => {
    try {
      await verifySocietyCandidate(s.slug);
    } catch (err) { failed(err, 'Could not verify that society.'); return; }
    setBump((n) => n + 1);
    toast(`“${s.name}” verified — now a first-class society`, 'success');
  });
  const openMerge = (cand) => setMerge({ cand, target: (cand.dupes && cand.dupes[0] && cand.dupes[0].slug) || '', query: '' });
  const confirmMerge = async () => {
    if (!merge || !merge.target) { toast('Pick a society to merge into.', 'error'); return; }
    if (merging) return;
    setMerging(true);
    try {
      await mergeSocieties(merge.cand.slug, merge.target);
    } catch (err) {
      /* Surfaced verbatim, and this is the one dialog where that matters most. Every refusal here
         names the merge that has to be undone first, so the operator's next action is one corrected
         request rather than an investigation — and a generic "could not merge" would throw that
         away on the screen where the input is two rows differing by a typo. */
      failed(err, 'Could not merge those two societies.');
      return;
    } finally {
      setMerging(false);
    }
    setMerge(null); setBump((n) => n + 1);
    toast('Duplicate merged — its listings, follows and reviews now read on the survivor', 'success');
  };
  /* Undo is keyed by the society that was merged away, and the button lives beside that row for the
     same reason: a survivor can have absorbed several duplicates, so "undo the merge on this
     society" is ambiguous anywhere else. */
  const undoMerge = (m) => withDeciding(m.slug, async () => {
    try {
      await undoSocietyMerge(m.slug);
    } catch (err) { failed(err, 'Could not undo that merge.'); return; }
    setBump((n) => n + 1);
    toast(`“${m.name}” stands on its own again`, 'info');
  });
  /* The merge picker.
     This used to rank the bundled 348 rows, which meant a society minted over the API a moment ago
     could not be picked as a survivor — a real limit on the one action whose input is two
     societies, and one `live-societies.spec.js` worked around by merging into a catalogue name,
     which is a test bending to a gap. It now searches `GET /societies?q=`, so the picker sees what
     the server sees and the workaround is no longer load-bearing. */
  const { rows: mergeCandidates } = useSocietySearch(
    merge ? merge.query : '',
    merge ? titleCase(merge.cand.localitySlug) : '',
    !!merge,
  );
  const mergeResults = useMemo(() => {
    if (!merge) return [];
    return mergeCandidates.filter((r) => r.slug !== merge.cand.slug).slice(0, 8);
  }, [merge, mergeCandidates]);

  /* Slug to the *list* of that society's pending detail suggestions, not to one of them. The old
     store held a single pending suggestion per society, so the slug identified it; the server
     holds a queue, and `Object.fromEntries` would silently keep only the last — the other
     resident's suggestion would be unreachable from the candidate row that should surface it. */
  const suggMap = useMemo(() => {
    const out = {};
    for (const s of suggestions) {
      if (!out[s.slug]) out[s.slug] = [];
      out[s.slug].push(s);
    }
    return out;
  }, [suggestions]);
  const applyReview = async () => {
    if (!review) return;
    try {
      await decideSocietyProposal(review.id, { status: 'approved' });
    } catch (err) { failed(err, 'Could not apply those details.'); return; }
    setReview(null); setBump((n) => n + 1);
    toast('Details applied — now shown as community-provided', 'success');
  };
  const dismissReview = async () => {
    if (!review) return;
    try {
      await decideSocietyProposal(review.id, { status: 'rejected' });
    } catch (err) { failed(err, 'Could not dismiss that suggestion.'); return; }
    setReview(null); setBump((n) => n + 1);
    toast('Suggestion dismissed', 'info');
  };

  /* Opens from the server's copy, not from the directory row beside it. The four public facts do
     appear on that row, but `adminNote` does not and never will — it is moderator prose about a
     named building, deliberately kept off the payload every anonymous reader gets. Reading it from
     `dzSocietyOverlay` was what made the note private to whichever browser typed it. */
  const openEdit = async (s) => {
    let row;
    try {
      row = await getSocietyAdminView(s.slug);
    } catch (err) { failed(err, 'Could not open that society.'); return; }
    setEdit({
      slug: row.slug, name: row.name,
      registration: row.registration, conveyance: row.conveyance,
      maintenancePerSqft: row.maintenancePerSqft ?? 3,
      claimStatus: row.claimStatus || 'unclaimed',
      adminNote: row.adminNote || '',
    });
  };
  const saveEdit = async () => {
    const patch = {
      registration: edit.registration, conveyance: edit.conveyance,
      maintenancePerSqft: Number(edit.maintenancePerSqft) || 0,
      claimStatus: edit.claimStatus, adminNote: edit.adminNote.trim(),
    };
    /* Awaited, and the dialog stays open on failure. This form used to write a browser-side overlay
       and could not fail, so "Society details saved" was safe to say unconditionally. Against a
       route it is not: these are the four fields a buyer reads to judge whether a building's
       paperwork is in order, and a toast claiming a save that 403'd or 422'd is worse than no toast
       — the operator closes the dialog believing the record is corrected. `adminNote` is sent even
       when empty, because '' clears the note and absent would leave it. */
    try {
      await editSociety(edit.slug, patch);
    } catch (err) { failed(err, 'Could not save that society.'); return; }
    setEdit(null); setBump((n) => n + 1);
    toast('Society details saved', 'success');
  };

  const KPIS = [
    /* `dir.total`, not `dir.items.length` — the page is twenty rows and the tile means "how many
       societies exist". Reading the array would have shown 20 with no compile error and no failing
       assertion beyond the one spec that pins it above 300, which is the only reason this is not a
       silent regression. It follows the search box: with a filter applied the tile is the size of
       the filtered set, which is the number the operator is looking at. */
    { label: 'Societies', value: dir.status === 'ready' ? fmtNum(dir.total) : '—', icon: Building2, tab: 'directory' },
    { label: 'Pending claims', value: fmtNum(pendingClaims), icon: ShieldCheck, tab: 'claims' },
    { label: 'Pending residents', value: fmtNum(pendingRes), icon: Home, tab: 'residents' },
    { label: 'Candidates', value: fmtNum(candidates.length), icon: Sparkles, tab: 'candidates' },
    { label: 'Open reports', value: fmtNum(reports.length + waPending.length + locFixes.length), icon: Flag, tab: 'moderation' },
  ];

  const inp = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-teal-400/50';

  return (
    <div>
      <PageHeader title="Societies" subtitle="Approve society claims, verify residents & edit society profiles." />

      {queueErrors.length ? (
        <div role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
          The {queueErrors.join(' and ')} {queueErrors.length > 1 ? 'queues' : 'queue'} could not be
          loaded, so {queueErrors.length > 1 ? 'those tabs are' : 'that tab is'} showing nothing
          rather than nothing to do. The counts above are wrong for the same reason.{' '}
          <button onClick={() => setBump((n) => n + 1)} className="underline underline-offset-2">Retry</button>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {KPIS.map((k) => (
          <div key={k.label} onClick={() => setTab(k.tab)} className="dz-card p-4 cursor-pointer hover:bg-white/5">
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{k.label}</div><div className="mt-1 text-2xl font-extrabold">{k.value}</div></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><k.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      <HScroll fadeColor="var(--brand-card, #1a1730)" wrapClassName="mb-4" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {[['claims', 'Claims'], ['residents', 'Resident Verifications'], ['candidates', 'Candidates'], ['directory', 'Directory'], ['moderation', 'Moderation']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {label}
          </button>
        ))}
      </HScroll>

      <p className="mb-2 text-xs text-gray-400">
        {tab === 'claims' ? 'RWA / committee requests to manage a society. Approving flips the public hub to “Managed on Draazy”.'
          : tab === 'residents' ? 'Residents proving they live in a society. Verifying grants a Resident badge on their reviews & answers.'
            : tab === 'candidates' ? 'Auto-minted community societies (from listings & searcher demand) awaiting review. Verify the real ones; merge duplicates into a canonical society — listings & followers redirect automatically.'
              : tab === 'moderation' ? 'Community moderation queue. Review resident reports on society content, approve/reject proposed resident WhatsApp group links (approved links are shared with verified residents only — never the public), and confirm resident-proposed location corrections (anti-scam gate).'
                : 'All societies with admin overlay. Edits are stored as an overlay on the static catalogue.'}
      </p>
      {tab === 'claims' ? <ClaimsTab claims={claims} decideClaim={decideClaim} deciding={deciding} viewCertificate={viewCertificate} opening={opening} /> : null}
      {tab === 'residents' ? <ResidentsTab residents={residents} decideResident={decideResident} deciding={deciding} /> : null}
      {tab === 'candidates' ? <CandidatesTab candidates={candidateRows} merges={merges} suggestions={suggestions} suggMap={suggMap} setMerge={setMerge} setReview={setReview} verifyCand={verifyCand} openMerge={openMerge} undoMerge={undoMerge} deciding={deciding} /> : null}
      {tab === 'directory' ? (
        <DirectoryTab
          state={dir}
          query={dirQuery}
          onQuery={setDirQuery}
          page={dirPage}
          pageSize={DIR_PAGE_SIZE}
          onPage={setDirPage}
          openEdit={openEdit}
        />
      ) : null}
      {tab === 'moderation' ? <ModerationTab reports={reports} waPending={waPending} locFixes={locFixes} decideReport={decideReport} decideWa={decideWa} decideLoc={decideLoc} deciding={deciding} /> : null}

      {edit && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setEdit(null)}>
          <div role="dialog" aria-modal="true" aria-label="Edit society" className="dz-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">{edit.name}</h3>
            <p className="text-gray-400 text-sm mb-4">Overlay edits — override the catalogue without touching source data.</p>
            <div className="space-y-3">
              <label className="flex items-center justify-between text-sm"><span>Registration verified</span>
                <input type="checkbox" checked={edit.registration} onChange={(e) => setEdit({ ...edit, registration: e.target.checked })} className="accent-teal-500 h-4 w-4" /></label>
              <label className="flex items-center justify-between text-sm"><span>Conveyance done</span>
                <input type="checkbox" checked={edit.conveyance} onChange={(e) => setEdit({ ...edit, conveyance: e.target.checked })} className="accent-teal-500 h-4 w-4" /></label>
              <label className="block text-sm">Claim status
                <select value={edit.claimStatus} onChange={(e) => setEdit({ ...edit, claimStatus: e.target.value })} className={inp + ' mt-1'}>
                  <option value="unclaimed">Unclaimed</option>
                  <option value="pending">Pending</option>
                  <option value="claimed">Claimed</option>
                </select>
              </label>
              <label className="block text-sm">Maintenance (₹/sqft)
                <input type="number" min="0" value={edit.maintenancePerSqft} onChange={(e) => setEdit({ ...edit, maintenancePerSqft: e.target.value })} className={inp + ' mt-1'} /></label>
              <label className="block text-sm">Admin note
                <textarea rows={2} value={edit.adminNote} onChange={(e) => setEdit({ ...edit, adminNote: e.target.value })} className={inp + ' mt-1'} /></label>
            </div>
            <div className="mt-5 flex gap-2"><button onClick={() => setEdit(null)} className="btn-outline flex-1">Cancel</button><button onClick={saveEdit} className="btn-teal flex-1">Save</button></div>
          </div>
        </div>
      )}

      {merge && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setMerge(null)}>
          <div role="dialog" aria-modal="true" aria-label="Merge society" className="dz-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><GitMerge className="h-5 w-5 text-brand-teal" />Merge duplicate</h3>
            <p className="text-gray-400 text-sm mb-4">Fold <span className="text-white font-semibold">“{merge.cand.name}”</span> into a canonical society. Its listings, follows and reviews will read on that society instead; nothing is deleted, and the merge can be undone.</p>
            <label className="block text-sm mb-1 text-gray-300">Merge into</label>
            <input autoFocus value={merge.query} onChange={(e) => setMerge({ ...merge, query: e.target.value })} placeholder="Search societies…" className={inp} />
            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-white/10 divide-y divide-white/5">
              {mergeResults.length === 0 ? <div className="px-3 py-3 text-xs text-gray-500">No matches — try another name.</div> : mergeResults.map((r) => (
                <button key={r.slug} onClick={() => setMerge({ ...merge, target: r.slug })} className={classNames('flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5', merge.target === r.slug ? 'bg-brand-teal/10' : '')}>
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-white">{r.name}</span>
                    <span className="text-xs text-gray-400 capitalize">{titleCase(r.localitySlug)}</span>
                  </span>
                  {r.verified ? <Chip tone="bg-emerald-500/15 text-emerald-200" icon={<BadgeCheck className="h-3 w-3" />}>Verified</Chip> : merge.target === r.slug ? <Check className="h-4 w-4 text-brand-teal" /> : null}
                </button>
              ))}
            </div>
            <div className="mt-5 flex gap-2"><button onClick={() => setMerge(null)} className="btn-outline flex-1">Cancel</button><button onClick={confirmMerge} disabled={!merge.target || merging} className="btn-teal flex-1 disabled:opacity-40">{merging ? 'Merging…' : 'Merge'}</button></div>
          </div>
        </div>
      )}

      {review && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setReview(null)}>
          <div role="dialog" aria-modal="true" aria-label="Review community details" className="dz-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-300" />Review community details</h3>
            <p className="text-gray-400 text-sm mb-4">Member-suggested details for <span className="text-white font-semibold">“{review.name}”</span>. Applying shows them as <span className="text-white">community-provided</span> (not officially verified).</p>
            <dl className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
              {review.fields.builder ? <div className="flex justify-between gap-3"><dt className="text-gray-400">Builder</dt><dd className="text-white text-right">{review.fields.builder}</dd></div> : null}
              {review.fields.year ? <div className="flex justify-between gap-3"><dt className="text-gray-400">Year built</dt><dd className="text-white text-right">{review.fields.year}</dd></div> : null}
              {review.fields.towers ? <div className="flex justify-between gap-3"><dt className="text-gray-400">Towers / wings</dt><dd className="text-white text-right">{review.fields.towers}</dd></div> : null}
              {review.fields.units ? <div className="flex justify-between gap-3"><dt className="text-gray-400">Total units</dt><dd className="text-white text-right">{review.fields.units}</dd></div> : null}
              {review.fields.maintenancePerSqft ? <div className="flex justify-between gap-3"><dt className="text-gray-400">Maintenance</dt><dd className="text-white text-right">₹{review.fields.maintenancePerSqft}/sqft</dd></div> : null}
              {review.fields.amenities && review.fields.amenities.length ? <div className="flex justify-between gap-3"><dt className="text-gray-400">Amenities</dt><dd className="text-white text-right capitalize">{review.fields.amenities.map((a) => titleCase(a)).join(', ')}</dd></div> : null}
            </dl>
            <p className="mt-3 text-[11px] text-gray-500">Suggested {fmtDate(review.at)}{review.by ? ` · by ${review.by}` : ''}. Verify against the source before applying.</p>
            <div className="mt-5 flex gap-2"><button onClick={dismissReview} className="btn-outline flex-1">Dismiss</button><button onClick={applyReview} className="btn-teal flex-1">Apply details</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

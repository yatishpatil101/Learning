import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ShieldCheck, Home, BadgeCheck, Check, GitMerge, Sparkles, Flag } from 'lucide-react';
import { fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import { useSocietyCatalogue } from '../../lib/useSocietyCatalogue.js';
import { allSocieties } from '../../data/societies.js';
import {
  getResidentReqs, setResidentStatus,
  getSocietyOverlay, setSocietyOverlay, resolveSociety,
  getSocietyCandidates, verifyCommunitySociety, mergeSocieties, searchSocieties,
} from '../../lib/store.js';
import {
  listSocietyClaimQueue, decideSocietyClaim,
  listSocietyProposalQueue, decideSocietyProposal,
} from '../../services/societyService.js';
import { listReports, triageReport } from '../../services/reportService.js';
import { ApiError, NetworkError } from '../../services/http.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { titleCase, fmtDate, Chip } from './societies/helpers.jsx';
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

/**
 * A `details` proposal, dressed as the shape the candidates tab and the review dialog render.
 *
 * The wire is flat (`builder`, `buildYear`, …) where the old store nested everything under
 * `fields`, and it carries no society name or locality at all — a proposal references a society, it
 * does not restate it. Both are resolved from the catalogue here rather than left blank, because
 * that is where every other row on the candidates tab already gets them; the alternative is an ops
 * queue that says "Review details" beside a slug.
 */
const toSuggestionRow = (p) => {
  const society = resolveSociety(p.societySlug);
  return {
    id: p.id,
    slug: p.societySlug,
    name: society?.name || titleCase(p.societySlug),
    localitySlug: society?.localitySlug || '',
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
  };
};

export default function AdminSocieties() {
  const { toast } = useToast();
  const { user } = useAuth();
  const by = (user && user.name) || 'Admin';
  const [tab, setTab] = useTabParam(['claims', 'residents', 'candidates', 'directory', 'moderation'], 'claims');
  const [claims, setClaims] = useState([]);
  const [residents, setResidents] = useState([]);
  const [candidates, setCandidates] = useState([]);
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
  const [review, setReview] = useState(null); // pending suggestion under review

  // Ops read this as the whole directory, and the merge picker searches it for a
  // canonical target — both are wrong against the curated-only head (D129).
  const catalogueReady = useSocietyCatalogue();

  /* Half of this screen now reads the API and half still reads localStorage, so `reload` cannot
     stay one synchronous statement. It is split rather than made wholly async: the two blocked
     clusters (resident verifications, community candidates) are still instant, and making them
     wait on three network round-trips would put an empty table on screen for no reason.

     `reloadSeq` is what stops a slow reload overwriting a fast one. Every decision below bumps
     `bump`, which re-fires the effect, so two reloads are routinely in flight at once — the first
     one carrying the pre-decision queue. Without the guard, whichever *response* landed last won,
     and the row an operator just approved would reappear as pending often enough to look like the
     write had failed. Only the newest request is allowed to call `setState`. */
  const reloadSeq = useRef(0);

  const reloadLocal = () => {
    setResidents(getResidentReqs());
    setCandidates(getSocietyCandidates());
  };

  const reload = async () => {
    reloadLocal();
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
    const [claimRows, proposals, openReports, reviewingReports] = await Promise.all([
      safe(listSocietyClaimQueue({ status: 'pending' }), 'claims', []),
      safe(listSocietyProposalQueue({ status: 'pending' }), 'community proposal', []),
      safe(listReports({ status: 'open' }), 'reports', { items: [] }),
      safe(listReports({ status: 'reviewing' }), 'reports', { items: [] }),
    ]);
    if (seq !== reloadSeq.current) return; // a newer reload has already answered

    // Both report reads carry the same label, so a double failure would otherwise render as
    // "The reports and reports queues could not be loaded" — a disclosure banner that looks broken.
    setQueueErrors([...new Set(broke)]);
    setClaims(claimRows);
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
  // `catalogueReady` is a real dependency, not a redundant one: getSocietyCandidates()
  // runs suggestDuplicates(), which reads allSocieties(). Keyed on `bump` alone this
  // scan only ever saw the 28 curated rows, so a candidate that is a textbook duplicate
  // of a RERA society came back with `dupes: []` — and openMerge() then opened the
  // merge dialog with no target, which reads to the operator as "no duplicate exists"
  // and gets the junk row verified into a permanent one.
  useEffect(() => { reload(); }, [bump, catalogueReady]); // eslint-disable-line react-hooks/exhaustive-deps -- `reload` is redeclared every render; the two signals above are the real inputs.

  /* eslint-disable-next-line react-hooks/exhaustive-deps -- `bump` and `catalogueReady` are
     invalidation signals, not values: `allSocieties()` reads a module-level store that the
     catalogue chunk and local writes mutate in place, which the rule cannot see. Dropping either
     leaves the directory showing 28 of 348 rows forever. See `lib/useSocietyCatalogue.js`. */
  const directory = useMemo(() => allSocieties().map((s) => resolveSociety(s.slug) || s), [bump, catalogueReady]);
  const pendingClaims = claims.filter((c) => c.status === 'pending').length;
  const pendingRes = residents.filter((r) => r.status === 'pending').length;

  /* Ten `logAudit('Societies', …)` calls stood one line below each of the ten decisions in this
     block — claim, resident, report, WhatsApp, location, verify, merge, apply, dismiss, edit. They
     are gone, and the reason is not that the audit question was answered.

     `logAudit` unshifted a sentence onto `db.auditLog` in this browser's localStorage, capped at
     200 rows. Exactly one screen ever read that array: Admin ▸ Settings ▸ Audit log. Every write
     underneath these ten lines goes to `lib/store/societyAdmin.js`, which uses its own `pnSociety*`
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
  const decideResident = (r, status) => {
    const out = setResidentStatus(r.slug, r.mobile, status, by);
    if (out === 'conflict') { toast('Unit already held by another verified resident — cannot verify.', 'error'); return; }
    reloadLocal(); // still a localStorage cluster; no reason to re-fetch three queues for it
    toast(status === 'verified' ? 'Resident verified' : 'Resident request rejected', status === 'verified' ? 'success' : 'info');
  };

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

  const verifyCand = (s) => {
    verifyCommunitySociety(s.slug, by);
    setBump((n) => n + 1);
    toast(`“${s.name}” verified — now a first-class society`, 'success');
  };
  const openMerge = (cand) => setMerge({ cand, target: (cand.dupes && cand.dupes[0] && cand.dupes[0].slug) || '', query: '' });
  const confirmMerge = () => {
    if (!merge || !merge.target) { toast('Pick a society to merge into.', 'error'); return; }
    const out = mergeSocieties(merge.cand.slug, merge.target);
    if (!out) { toast('Could not merge — invalid target.', 'error'); return; }
    setMerge(null); setBump((n) => n + 1);
    toast('Duplicate merged — listings & followers redirected', 'success');
  };
  const mergeResults = useMemo(() => {
    if (!merge) return [];
    return searchSocieties(merge.query, titleCase(merge.cand.localitySlug))
      .filter((r) => r.slug !== merge.cand.slug)
      .slice(0, 8);
  }, [merge, catalogueReady]); // eslint-disable-line react-hooks/exhaustive-deps -- see `directory` above: `searchSocieties` reads the mutable module store.

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

  const openEdit = (s) => {
    const o = getSocietyOverlay(s.slug) || {};
    setEdit({
      slug: s.slug, name: s.name,
      registration: s.registration, conveyance: s.conveyance,
      maintenancePerSqft: s.maintenancePerSqft ?? 3,
      claimStatus: s.claimStatus || 'unclaimed',
      adminNote: o.adminNote || '',
    });
  };
  const saveEdit = () => {
    const patch = {
      registration: edit.registration, conveyance: edit.conveyance,
      maintenancePerSqft: Number(edit.maintenancePerSqft) || 0,
      claimStatus: edit.claimStatus, adminNote: edit.adminNote.trim(),
    };
    setSocietyOverlay(edit.slug, patch);
    setEdit(null); setBump((n) => n + 1);
    toast('Society details saved', 'success');
  };

  const KPIS = [
    { label: 'Societies', value: fmtNum(directory.length), icon: Building2, tab: 'directory' },
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
          <div key={k.label} onClick={() => setTab(k.tab)} className="pn-card p-4 cursor-pointer hover:bg-white/5">
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
        {tab === 'claims' ? 'RWA / committee requests to manage a society. Approving flips the public hub to “Managed on PuneNest”.'
          : tab === 'residents' ? 'Residents proving they live in a society. Verifying grants a Resident badge on their reviews & answers.'
            : tab === 'candidates' ? 'Auto-minted community societies (from listings & searcher demand) awaiting review. Verify the real ones; merge duplicates into a canonical society — listings & followers redirect automatically.'
              : tab === 'moderation' ? 'Community moderation queue. Review resident reports on society content, approve/reject proposed resident WhatsApp group links (approved links are shared with verified residents only — never the public), and confirm resident-proposed location corrections (anti-scam gate).'
                : 'All societies with admin overlay. Edits are stored as an overlay on the static catalogue.'}
      </p>
      {tab === 'claims' ? <ClaimsTab claims={claims} decideClaim={decideClaim} deciding={deciding} /> : null}
      {tab === 'residents' ? <ResidentsTab residents={residents} decideResident={decideResident} /> : null}
      {tab === 'candidates' ? <CandidatesTab candidates={candidates} suggestions={suggestions} suggMap={suggMap} setMerge={setMerge} setReview={setReview} verifyCand={verifyCand} openMerge={openMerge} /> : null}
      {tab === 'directory' ? <DirectoryTab directory={directory} openEdit={openEdit} /> : null}
      {tab === 'moderation' ? <ModerationTab reports={reports} waPending={waPending} locFixes={locFixes} decideReport={decideReport} decideWa={decideWa} decideLoc={decideLoc} deciding={deciding} /> : null}

      {edit && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setEdit(null)}>
          <div role="dialog" aria-modal="true" aria-label="Edit society" className="pn-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
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
          <div role="dialog" aria-modal="true" aria-label="Merge society" className="pn-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><GitMerge className="h-5 w-5 text-brand-teal" />Merge duplicate</h3>
            <p className="text-gray-400 text-sm mb-4">Fold <span className="text-white font-semibold">“{merge.cand.name}”</span> into a canonical society. Its listings & followers will redirect there; the duplicate disappears.</p>
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
            <div className="mt-5 flex gap-2"><button onClick={() => setMerge(null)} className="btn-outline flex-1">Cancel</button><button onClick={confirmMerge} disabled={!merge.target} className="btn-teal flex-1 disabled:opacity-40">Merge</button></div>
          </div>
        </div>
      )}

      {review && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setReview(null)}>
          <div role="dialog" aria-modal="true" aria-label="Review community details" className="pn-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
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

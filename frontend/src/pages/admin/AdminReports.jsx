import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Ban, Building2, CheckCircle2, Download, Eye, Flag, Search, UserX, XCircle } from 'lucide-react';
import { listReports, triageReport } from '../../services/reportService.js';
import { canTriage } from '../../services/providers/http/reportMapper.js';
import { LISTING_REPORT_REASONS, OWNER_REPORT_REASONS, SHARE_REPORT_REASONS, SOCIETY_REPORT_REASONS } from '../../lib/reportReasons.js';
import { fmtNum, classNames, timeAgo } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import Table from '../../components/ui/Table.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');

/**
 * The queue's status vocabulary, reconciled with the server's.
 *
 * The server has four — `open`, `reviewing`, `actioned`, `dismissed` — and this list had a fifth,
 * `resolved`, that has never existed on the wire. It meant "reviewed, no action needed", which is
 * exactly what `dismissed` means; the mapper translates it on the way out so a triage still works,
 * but showing it as a *filter* would offer a state no live report can be in.
 *
 * `reviewing` is the reverse case: real server-side, no button here. Listed so the filter can reach
 * reports another moderator has picked up.
 */
const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'reviewing', label: 'Being reviewed' },
  { value: 'actioned', label: 'Action taken' },
  { value: 'dismissed', label: 'Dismissed' },
];

/**
 * The reason filter, derived from the vocabularies reporters actually choose from.
 *
 * This list used to be hand-written, and it was wrong in both directions. It offered `inaccurate`
 * and `offensive` — codes no report can carry, because neither appears in any of the three
 * `ReportModal` vocabularies the server validates against, so selecting either always emptied the
 * queue and looked like "no such complaints". And it omitted nine codes reports *do* carry:
 * `sold`, `unavailable`, `pricing`, `broker`, `brokerage`, `abuse`, `fakelistings`, `filled`,
 * `inappropriate` and `other`. On an Indian rental marketplace "posted by a broker, not the owner"
 * is among the commonest complaints filed, and it was not filterable at all.
 *
 * That is the same defect `STATUS_OPTS` above had with its phantom `resolved`, three lines away,
 * fixed on its own while this list was left alone. Hand-maintained mirrors of a vocabulary drift
 * one at a time. So this one is not maintained: it is *derived* from the exact arrays the modal
 * offers and the backend's `ReportReasons` mirrors, and cannot drift without the modal changing.
 *
 * Keyed by tab because reasons are per target type — the server's rule is "this reason must be
 * valid *for this target type*". `pricing` is a meaningful complaint about a listing and meaningless
 * about a person; `impersonation` the reverse. Offering the union would reintroduce, as a filter,
 * exactly the nonsensical pairings the server refuses to store.
 */
const REASON_OPTS = {
  listings: [{ value: '', label: 'All reasons' }, ...LISTING_REPORT_REASONS.map(([value, label]) => ({ value, label }))],
  users: [{ value: '', label: 'All reasons' }, ...OWNER_REPORT_REASONS.map(([value, label]) => ({ value, label }))],
  posts: [{ value: '', label: 'All reasons' }, ...SHARE_REPORT_REASONS.map(([value, label]) => ({ value, label }))],
  // One vocabulary for all five society kinds, because they are the same object seen through five
  // widgets: abuse in an answer and abuse on the noticeboard are the same abuse.
  society: [{ value: '', label: 'All reasons' }, ...SOCIETY_REPORT_REASONS.map(([value, label]) => ({ value, label }))],
};

/**
 * Which `kind` each tab is responsible for.
 *
 * There are three because the wire has always had three. `toViewModel` maps `targetType: 'post'` to
 * `kind: 'share'`, and every flatmate report — room, group or seeker — is filed as one. The queue
 * had only two tabs and asked `kind === 'listing' ? … : kind === 'user'`, so a `share` row matched
 * neither branch and **rendered in no tab at all**: filed correctly, stored correctly, and
 * invisible to the moderators whose job it was.
 *
 * It hid behind a second bug. Flatmates.jsx used to send `kind='user'` with the *post* vocabulary,
 * which the server would have rejected outright and the mock stored anyway — so these reports
 * surfaced under "Reported users", mislabelled but reachable. Fixing the wire mapping is what made
 * them disappear, which is the ordinary way a latent gap becomes visible.
 *
 * `review` is deliberately absent as a tab of its own. `ReportReasons` knows the target type and
 * society reviews are filed under it, but they are moderated through the reviews queue and its own
 * `PATCH /reviews/{id}/status` — a tab here with no takedown behind it would be furniture.
 *
 * The fourth tab collects **five** kinds, which is why this maps to an array. A society hub's
 * recommendations, replies, questions, answers and noticeboard posts stay five distinct target
 * types on the wire, because a moderator upholding a complaint has to know which table the id
 * indexes — but to the person working the queue they are one thing: something a neighbour wrote.
 * Five tabs would have split one small queue five ways.
 */
const TAB_KIND = {
  listings: ['listing'],
  users: ['user'],
  posts: ['share'],
  society: ['contribution', 'reply', 'question', 'answer', 'board'],
};
const inTab = (r, t) => (TAB_KIND[t] || []).includes(r.kind);

export default function AdminReports() {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const [searchParams] = useSearchParams();
  const [all, setAll] = useState(null);
  const [tab, setTab] = useTabParam(['listings', 'users', 'posts', 'society'], 'listings');
  const [statusF, setStatusF] = useState('');
  const [reasonF, setReasonF] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(new Set());

  /**
   * Read the queue.
   *
   * Unfiltered: the tabs, the status filter and the repeat-offender badge are all computed over the
   * whole set client-side, so filtering server-side here would make those counts describe a subset
   * while looking like totals. The provider warns when the queue outgrows one page — at which point
   * this needs real paging, not a bigger page.
   */
  const load = () => listReports().then((res) => setAll(res.items)).catch(() => setAll([]));
  useEffect(() => { let alive = true; load().then(() => !alive); return () => { alive = false; }; }, []); // eslint-disable-line

  // Deep-link ?open=<id>
  useEffect(() => {
    if (!all) return;
    const oid = searchParams.get('open');
    if (oid) { const r = all.find((x) => x.id === oid); if (r) setDetail(r); }
  }, [all, searchParams]); // eslint-disable-line

  /**
   * A reason filter does not survive a tab change.
   *
   * The two tabs offer different vocabularies, so a reason chosen on one is frequently not a legal
   * complaint on the other. Left standing it would filter on a code no row in the new tab can
   * carry, and the moderator would read an empty queue as "no reports here" rather than "you are
   * filtering by something that cannot exist here".
   *
   * Derived rather than an effect. An effect would have to run *after* the tab change has painted,
   * so there would be one frame showing an empty table, a "0 of N" count and the raw code in the
   * trigger (`Select` falls back to `String(value)` when the value matches no option) — which is
   * the exact misreading this exists to prevent, just briefly. Deriving also keeps `hasFilters`
   * honest: an effect leaves `reasonF` set for that frame, so "Clear all filters" would offer to
   * clear a filter that is no longer being applied. `reasonF` is kept rather than cleared, so
   * going back to the original tab restores the moderator's filter instead of silently dropping it.
   */
  const reasonOpts = REASON_OPTS[tab] || REASON_OPTS.listings;
  const activeReason = reasonOpts.some((o) => o.value === reasonF) ? reasonF : '';

  /**
   * Triage one report.
   *
   * `actionTaken` is the queue's own label for what was done ("Listing taken down"). The server has
   * no such column — the moderator's words go to the audit log, attributable to whoever typed them,
   * so that "a triage note can never be mistaken for something the reporter said". It is passed as
   * the note and kept locally for the table.
   *
   * `enforcement` is the separate, machine-readable verb the server executes. It is deliberately not
   * inferred from `actionTaken`: that string is a human label which will be reworded or translated
   * one day, and the moment it is, an inferred enforcement silently becomes `none` and the queue
   * starts closing reports without touching the thing reported.
   */
  const act = async (id, status, actionTaken, enforcement) => {
    const note = window.prompt('Internal note (optional):');
    let updated;
    try {
      updated = await triageReport(id, { status, note: note || actionTaken, actionTaken, enforcement });
    } catch {
      toast('That decision could not be saved. Please reload the queue.', 'error');
      return;
    }
    // Neither `logAudit` nor `addInternalNote` here, and for the same reason: `ReportService.triage`
    // writes `report.triage` with the from-status, the to-status, the authenticated actor and — via
    // `body.note()` — this very string. Both lines that stood here wrote a second, browser-local
    // copy of something the server had already stored under a real author.
    //
    // `addInternalNote('report', id, note, …)` was the longer-lived of the two. It filed the note
    // under the key `report:<id>` in localStorage. Nothing in this app ever read that key: the
    // `InternalNote` widget is only mounted with `entityType="listing"`, and this screen does not
    // mount it at all. So the note was written, capped at 200 rows, and never shown to anyone.
    //
    // The `logAudit` line that also stood here wrote the *requested* status into a browser-local
    // array — and the comment immediately below explains why the requested status is not always the
    // stored one, which is the second reason that copy was worse than useless.
    // The server's answer is authoritative for `status` — `resolved` is recorded as `dismissed`,
    // so echoing the requested value would show a state the server did not store.
    const saved = updated?.status || status;
    const resolveAction = (existing) => (status === 'open' ? '' : (actionTaken || existing));
    setAll((prev) => prev.map((r) => r.id === id ? { ...r, status: saved, actionTaken: resolveAction(r.actionTaken), handledAt: Date.now() } : r));
    if (detail?.id === id) setDetail((d) => ({ ...d, status: saved, actionTaken: resolveAction(d.actionTaken), handledAt: Date.now() }));
    toast(actionTaken || (status === 'open' ? 'Reopened' : saved));
  };

  /**
   * Bulk decisions are N requests, not one.
   *
   * There is no bulk endpoint, and inventing one client-side means some can fail while others
   * succeed. `allSettled` so one refusal does not abandon the rest, then a single re-read: the
   * local state cannot be patched optimistically when an unknown subset may not have applied.
   */
  const bulkTriage = async (status, actionTaken, confirmMsg, doneMsg) => {
    if (!selected.size) return;
    if (!window.confirm(confirmMsg)) return;
    const ids = [...selected];
    const results = await Promise.allSettled(
      ids.map((id) => triageReport(id, { status, note: actionTaken, actionTaken })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setSelected(new Set());
    await load();
    if (failed) toast(`${ids.length - failed} of ${ids.length} updated — ${failed} could not be saved.`, 'error');
    else toast(doneMsg);
  };

  const bulkResolve = () => bulkTriage(
    'resolved',
    'Bulk resolved',
    `Resolve ${selected.size} report(s) as "Reviewed, no action needed"?`,
    `${selected.size} reports resolved`,
  );

  const bulkDismiss = () => bulkTriage(
    'dismissed',
    undefined,
    `Dismiss ${selected.size} report(s)?`,
    `${selected.size} reports dismissed`,
  );

  // Precompute report counts per target for escalation indicators (O(n) vs O(n^2) per-row)
  const targetCounts = useMemo(() => {
    const map = {};
    for (const r of (all || [])) { if (r.targetId) map[r.targetId] = (map[r.targetId] || 0) + 1; }
    return map;
  }, [all]);

  const kpis = useMemo(() => {
    const list = all || [];
    return {
      open: list.filter((r) => r.status === 'open').length,
      listings: list.filter((r) => inTab(r, 'listings')).length,
      users: list.filter((r) => inTab(r, 'users')).length,
      posts: list.filter((r) => inTab(r, 'posts')).length,
      society: list.filter((r) => inTab(r, 'society')).length,
      closed: list.filter((r) => r.status !== 'open').length,
    };
  }, [all]);

  const rows = useMemo(() => {
    let list = (all || []).filter((r) => inTab(r, tab));
    if (statusF) list = list.filter((r) => r.status === statusF);
    if (activeReason) list = list.filter((r) => r.reason === activeReason);
    if (dateRange) {
      const cutoff = Date.now() - Number(dateRange) * 86400000;
      list = list.filter((r) => r.at >= cutoff);
    }
    if (q) { const n = q.toLowerCase(); list = list.filter((r) => JSON.stringify(r).toLowerCase().includes(n)); }
    return list;
  }, [all, tab, statusF, activeReason, dateRange, q]);

  const hasFilters = statusF || activeReason || dateRange || q;
  const clearFilters = () => { setStatusF(''); setReasonF(''); setDateRange(''); setQ(''); };

  // Reset selection when filters or tab change
  useEffect(() => { setSelected(new Set()); }, [tab, statusF, activeReason, dateRange, q]);

  if (!all) return <Loading />;

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    const openRows = rows.filter((r) => r.status === 'open');
    if (selected.size === openRows.length && openRows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(openRows.map((r) => r.id)));
    }
  };

  const reportActions = (r) => (
    <div className="flex flex-wrap justify-end gap-1">
      <button onClick={() => setDetail(r)} className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5" title="View details"><Eye className="h-3.5 w-3.5" /></button>
      {canTriage(r) ? (
        <>
          {tab === 'listings'
            ? <button onClick={() => act(r.id, 'actioned', 'Listing taken down', 'hide_content')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300" title="Take down"><Ban className="mr-0.5 inline h-3 w-3" />Take down</button>
            : tab === 'posts'
              /* `hide_content`, not `suspend_account`. A flatmate post is content, and the offending
                 thing is the post — suspending the person who wrote it is a different, heavier
                 decision that the listings tab does not make either. */
              ? <button onClick={() => act(r.id, 'actioned', 'Post taken down', 'hide_content')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300" title="Take down"><Ban className="mr-0.5 inline h-3 w-3" />Take down</button>
              : tab === 'society'
                /* Same reasoning, and one consequence worth stating: upholding this removes the
                   post from the hub for everybody. That is the point — the reason `personal`
                   exists is a recommendation publishing a tradesman's real mobile number, and a
                   complaint that leaves it up has not answered him. */
                ? <button onClick={() => act(r.id, 'actioned', 'Society post removed', 'hide_content')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300" title="Remove post"><Ban className="mr-0.5 inline h-3 w-3" />Remove</button>
                : <button onClick={() => act(r.id, 'actioned', 'User suspended', 'suspend_account')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300" title="Suspend user"><Ban className="mr-0.5 inline h-3 w-3" />Suspend</button>}
          <button onClick={() => act(r.id, 'resolved', 'Reviewed, no action needed')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal" title="Resolve"><CheckCircle2 className="mr-0.5 inline h-3 w-3" />Resolve</button>
          <button onClick={() => act(r.id, 'dismissed')} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5" title="Dismiss"><XCircle className="mr-0.5 inline h-3 w-3" />Dismiss</button>
        </>
      ) : (
        /* No Reopen. A decided report is terminal server-side, and the refusal is the point:
           re-opening erases the record that somebody judged it, and is the obvious way for one
           moderator to quietly undo a colleague's decision. Filing afresh costs nothing and leaves
           both decisions visible. The button used to be here and would now 409 on click. */
        <span className="px-2 py-1 text-xs text-gray-500" title="A decided report cannot be reopened — file a new one if it recurs">Decided</span>
      )}
    </div>
  );

  const cols = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          checked={rows.filter((r) => r.status === 'open').length > 0 && selected.size === rows.filter((r) => r.status === 'open').length}
          onChange={toggleAll}
          className="accent-teal-400 w-4 h-4 rounded"
          title="Select all open"
        />
      ),
      className: 'w-10',
      render: (r) => r.status === 'open' ? (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          className="accent-teal-400 w-4 h-4 rounded"
        />
      ) : null,
    },
    {
      key: 'target',
      header: tab === 'listings' ? 'Property' : tab === 'posts' ? 'Flatmate post' : tab === 'society' ? 'Society post' : 'User / Owner',
      render: (r) => {
        const repeatCount = (targetCounts[r.targetId] || 1);
        return (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{r.targetTitle || r.targetId || '—'}</span>
              {repeatCount >= 3 && (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-red-400/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300" title={`${repeatCount} reports on this target`}>
                  <AlertTriangle className="h-2.5 w-2.5" /> {repeatCount}x
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400">{r.targetOwner || ''}{r.ownerMobile ? ' · ' + r.ownerMobile : ''}</div>
          </div>
        );
      },
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => (
        <div>
          <div className="font-medium">{r.reasonLabel}</div>
          {r.details ? <div className="max-w-xs truncate text-xs text-gray-400">{r.details}</div> : null}
        </div>
      ),
    },
    {
      key: 'reporter',
      /**
       * The reporter, when we are allowed to name them.
       *
       * Live, we never are. `ReportResponse` omits `reporterId` deliberately — the queue tells a
       * moderator *what* was complained about and *why*, not *who* complained, because naming the
       * reporter to every member of ops is how a complaint becomes a reprisal. The http mapper
       * therefore resolves `reportedBy` to `''` on every row.
       *
       * The fallback is "Withheld", not "Anonymous", and the difference is the whole point. The
       * reporter is *not* anonymous: `reports.reporter_id` is NOT NULL and drives the duplicate
       * check. The platform knows exactly who filed this. "Anonymous" would tell a moderator the
       * reporter chose not to identify themselves — and an unattributable complaint is a much
       * easier one to dismiss. "Withheld" says the true thing: somebody is on the hook for this
       * report, and it isn't your business who.
       *
       * The mock denormalises a name onto the row, so this column only ever looked populated
       * because it was being fed invented data. When the mock goes at P5c the `||` branch becomes
       * the only branch.
       */
      header: 'Reported by',
      render: (r) => (
        <div>
          <div>{r.reportedBy || 'Withheld'}</div>
          {r.reporterMobile ? <div className="text-xs text-gray-400">{r.reporterMobile}</div> : null}
        </div>
      ),
    },
    {
      key: 'at',
      header: 'Reported',
      render: (r) => (
        <div className="text-xs text-gray-400">
          <div>{fmtDate(r.at)}</div>
          <div className="text-gray-500">{timeAgo(r.at)}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => reportActions(r),
    },
  ];

  const reportCard = (r) => {
    const repeatCount = targetCounts[r.targetId] || 1;
    return (
      <div className={classNames('pn-card p-3.5', selected.has(r.id) && 'ring-1 ring-teal-400/40')}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {r.status === 'open' ? (
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} className="mt-1 h-4 w-4 shrink-0 rounded accent-teal-400" aria-label="Select report" />
            ) : null}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{r.targetTitle || r.targetId || '—'}</span>
                {repeatCount >= 3 && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-red-400/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300"><AlertTriangle className="h-2.5 w-2.5" /> {repeatCount}x</span>
                )}
              </div>
              <div className="truncate text-xs text-gray-400">{r.targetOwner || ''}{r.ownerMobile ? ' · ' + r.ownerMobile : ''}</div>
            </div>
          </div>
          <Badge status={r.status} />
        </div>
        <div className="mt-2 text-sm">
          <span className="font-medium">{r.reasonLabel}</span>
          {r.details ? <span className="text-gray-400"> — {r.details}</span> : null}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500">
          {/* "Withheld", matching the table column and the detail drawer — see the `reporter`
              column for why the distinction from "Anonymous" matters. */}
          <span className="truncate">By {r.reportedBy || 'Withheld'}{r.reporterMobile ? ` · ${r.reporterMobile}` : ''}</span>
          <span className="shrink-0">{timeAgo(r.at)}</span>
        </div>
        <div className="mt-3 border-t border-white/5 pt-3">
          {reportActions(r)}
        </div>
      </div>
    );
  };

  const doExport = () => exportCsv(
    `punenest-reports-${tab}.csv`,
    ['ID', 'Kind', 'Target', 'Reason', 'Reporter', 'Reported', 'Status', 'Action Taken'],
    // Same "Withheld" as every on-screen surface. A blank cell in an exported sheet is read as
    // missing data rather than as withheld data, which is the ambiguity the wording exists to avoid.
    rows.map((r) => [r.id, r.kind, r.targetTitle || r.targetId, r.reasonLabel, r.reportedBy || 'Withheld', fmtDate(r.at), r.status, r.actionTaken || '']),
  );

  const KPIS = [
    { label: 'Open reports', value: fmtNum(kpis.open), icon: Flag, clickTab: null, color: 'text-amber-400' },
    { label: 'Reported properties', value: fmtNum(kpis.listings), icon: Building2, clickTab: 'listings', color: 'text-brand-teal' },
    { label: 'Reported users', value: fmtNum(kpis.users), icon: UserX, clickTab: 'users', color: 'text-rose-400' },
    { label: 'Reported posts', value: fmtNum(kpis.posts), icon: Flag, clickTab: 'posts', color: 'text-violet-400' },
    { label: 'Closed', value: fmtNum(kpis.closed), icon: CheckCircle2, clickTab: null, color: 'text-emerald-400' },
  ];

  return (
    <div>
      <PageHeader
        title="Reports & Moderation"
        subtitle="Review reported properties, users and flatmate posts, and take action."
        actions={<button onClick={doExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" />Export CSV</button>}
      />

      {/* KPI tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {KPIS.map((k) => (
          <div key={k.label} onClick={k.clickTab ? () => setTab(k.clickTab) : undefined} className={classNames('pn-card p-4', k.clickTab && 'cursor-pointer hover:bg-white/5 transition')}>
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{k.label}</div><div className="mt-1 text-2xl font-extrabold">{k.value}</div></div>
              <span className={classNames('grid h-9 w-9 place-items-center rounded-xl bg-white/5', k.color)}><k.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <HScroll fadeColor="var(--brand-card, #1a1730)" wrapClassName="mb-4" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            {[['listings', 'Reported properties', kpis.listings, 'reports.properties'], ['users', 'Reported users & owners', kpis.users, 'reports.users'], ['posts', 'Reported flatmate posts', kpis.posts, 'reports.posts'], ['society', 'Reported society posts', kpis.society, 'reports.society']].map(([id, label, count, flag]) => (
          optionEnabled(flag) ? (
            <button key={id} onClick={() => setTab(id)} className={classNames('flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
              {label} <span className="opacity-70">({fmtNum(count)})</span>
            </button>
          ) : null
        ))}
      </HScroll>

      {/* Filter bar */}
      <div className="pn-card mb-4 p-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-1/2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search reports…"
              className="pn-input w-full"
              style={{ paddingLeft: '2.25rem' }}
            />
          </div>
          <div className="flex w-full gap-2 sm:w-1/2">
            <div className="w-1/2">
              {/* `searchable={false}` on both: `Select` turns itself into a search combobox at eight
                  options and autofocuses the input, which on mobile summons the keyboard over a
                  bottom sheet of eight items. Both reason lists are exactly eight, status is five,
                  so without this the two filters sitting side by side would behave differently. */}
              <Select value={statusF} onChange={setStatusF} options={STATUS_OPTS} searchable={false} ariaLabel="Filter by status" />
            </div>
            <div className="w-1/2">
              <Select value={activeReason} onChange={setReasonF} options={reasonOpts} searchable={false} ariaLabel="Filter by reason" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePills value={dateRange} onChange={setDateRange} />
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10 transition">
              <XCircle className="h-3.5 w-3.5" /> Clear all filters
            </button>
          )}
                <span className="text-xs text-gray-500 ml-auto">{rows.length} of {(all || []).filter((r) => inTab(r, tab)).length}</span>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-teal-400/30 bg-teal-500/10 px-4 py-2.5">
          <span className="text-sm font-medium text-teal-200">{selected.size} selected</span>
          <button onClick={bulkResolve} className="pn-btn pn-btn-primary px-3 py-1.5 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Bulk Resolve</button>
          <button onClick={bulkDismiss} className="pn-btn pn-btn-ghost px-3 py-1.5 text-xs"><XCircle className="h-3.5 w-3.5" /> Bulk Dismiss</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-gray-400 hover:text-white">Deselect all</button>
        </div>
      )}

      <Table columns={cols} rows={rows} pageSize={10} label="reports" empty="No reports match — all clear!" mobileCard={reportCard} />

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Report · ${detail.id}` : ''} size="lg">
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={detail.status} />
              <span className="rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-0.5 text-xs capitalize text-orange-300"><Flag className="mr-1 inline h-3 w-3" />{detail.kind} report</span>
              {(targetCounts[detail.targetId] || 1) >= 3 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                  <AlertTriangle className="h-3 w-3" /> Escalated ({(targetCounts[detail.targetId] || 1)} reports)
                </span>
              )}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {[
                ['Item', detail.targetTitle || detail.targetId],
                ['Owner', detail.targetOwner || '—'],
                ['Owner mobile', detail.ownerMobile || '—'],
                ['Reason', detail.reasonLabel || detail.reason],
                ['Reported by', detail.reportedBy || 'Withheld'],
                ['Reporter mobile', detail.reporterMobile || '—'],
                ['Reported', fmtDate(detail.at)],
                ['Handled at', detail.handledAt ? fmtDate(detail.handledAt) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-white/5 py-1.5">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className="font-medium text-right">{v}</dd>
                </div>
              ))}
            </dl>
            {detail.details ? <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-300">&ldquo;{detail.details}&rdquo;</p> : null}
            {detail.actionTaken ? <p className="text-sm text-emerald-300">Action: {detail.actionTaken}</p> : null}
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
              {canTriage(detail) ? (
                <>
                  {detail.kind === 'listing'
                    ? <button onClick={() => act(detail.id, 'actioned', 'Listing taken down', 'hide_content')} className="pn-btn pn-btn-ghost text-red-300"><Ban className="h-4 w-4" />Take down</button>
                    : <button onClick={() => act(detail.id, 'actioned', 'User suspended', 'suspend_account')} className="pn-btn pn-btn-ghost text-red-300"><Ban className="h-4 w-4" />Suspend</button>}
                  <button onClick={() => act(detail.id, 'resolved', 'Reviewed, content kept')} className="pn-btn pn-btn-ghost"><CheckCircle2 className="h-4 w-4" />Resolve</button>
                  <button onClick={() => act(detail.id, 'dismissed')} className="pn-btn pn-btn-ghost text-gray-300"><XCircle className="h-4 w-4" />Dismiss</button>
                </>
              ) : (
                /* Same as the row actions: a decided report is terminal server-side, so there is no
                   Reopen here either. This copy was missed when the row was fixed — the drawer still
                   rendered the old button, which was both a dead `RotateCcw` reference (the import
                   had gone) and a control that would 409 on click. */
                <span className="px-2 py-1 text-xs text-gray-500" title="A decided report cannot be reopened — file a new one if it recurs">Decided</span>
              )}
              <button onClick={() => setDetail(null)} className="pn-btn pn-btn-primary ml-auto">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
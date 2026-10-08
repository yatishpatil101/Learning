import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Ban, CheckCircle2, Download, Eye, Flag, XCircle } from 'lucide-react';
import { listReports, triageReport } from '../../services/reportService.js';
import { canTriage } from '../../services/providers/http/reportMapper.js';
import { LISTING_REPORT_REASONS, OWNER_REPORT_REASONS, SHARE_REPORT_REASONS } from '../../lib/reportReasons.js';
import { fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPermission } from '../../lib/adminModules.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, Cell, Chips, ClearFilters, DATE_CHIPS, FactRow, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox, useClientPaging,
} from '../../components/admin/WorkQueue.jsx';
import ReviewsTab from './reports/ReviewsTab.jsx';

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');

/** `resolved` is omitted: it equals `dismissed` server-side, so
 * filtering on it would offer a state no report can be in. */
const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'reviewing', label: 'Being reviewed' },
  { value: 'actioned', label: 'Action taken' },
  { value: 'dismissed', label: 'Dismissed' },
];

/** Derived from the arrays ReportModal offers so the filter can't
 * drift; keyed by tab as reasons are valid per target type. */
const REASON_OPTS = {
  listings: [{ value: '', label: 'All reasons' }, ...LISTING_REPORT_REASONS.map(([value, label]) => ({ value, label }))],
  users: [{ value: '', label: 'All reasons' }, ...OWNER_REPORT_REASONS.map(([value, label]) => ({ value, label }))],
  posts: [{ value: '', label: 'All reasons' }, ...SHARE_REPORT_REASONS.map(([value, label]) => ({ value, label }))],
};

/** Which `kind` each tab owns; a kind missing here renders in no tab. `review` is absent on purpose:
 * reviews are moderated through `PATCH /reviews/{id}/status`. */
const TAB_KIND = {
  listings: ['listing'],
  users: ['user'],
  posts: ['share'],
};
const inTab = (r, t) => (TAB_KIND[t] || []).includes(r.kind);

const TABS = [
  { key: 'listings', label: 'Properties' },
  { key: 'users', label: 'Users & owners' },
  { key: 'posts', label: 'Flatmate posts' },
];

const NOTES = {
  listings: 'Complaints about listings. Take down hides the listing from search; Resolve keeps it up. Tab count = reports still undecided.',
  users: 'Complaints about people. Suspend blocks the account; Resolve keeps it active. The reporter is withheld on purpose.',
  posts: 'Complaints about flatmate rooms, groups and seeker posts. Take down hides the post; its author is not suspended.',
};

const KIND_LABEL = {
  listing: 'Property', user: 'User', share: 'Flatmate post',
};

const PAGE_SIZE = 10;

export default function AdminReports() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canSeeReviews = hasPermission(user, 'properties:read');
  const [searchParams] = useSearchParams();
  const [all, setAll] = useState(null);
  const [tab, setTab] = useTabParam(['listings', 'users', 'posts', ...(canSeeReviews ? ['reviews'] : [])], 'listings');
  const [statusF, setStatusF] = useState('');
  const [reasonF, setReasonF] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(new Set());

  /** Reads the queue unfiltered: tabs, status filter and repeat-offender badge are computed client-side, so server filtering would make counts describe a subset. */
  const load = () => listReports().then((res) => setAll(res.items)).catch(() => setAll([]));
  useEffect(() => { let alive = true; load().then(() => !alive); return () => { alive = false; }; }, []); // eslint-disable-line

  useEffect(() => {
    if (!all) return;
    const oid = searchParams.get('open');
    if (oid) { const r = all.find((x) => x.id === oid); if (r) setDetail(r); }
  }, [all, searchParams]); // eslint-disable-line

  /** Derived, not an effect: an effect leaves a frame with a
   * stale reason; `reasonF` is kept so returning restores it. */
  const reasonOpts = REASON_OPTS[tab] || REASON_OPTS.listings;
  const activeReason = reasonOpts.some((o) => o.value === reasonF) ? reasonF : '';

  /** `enforcement` is the machine verb the server executes; never infer
   * it from the human `actionTaken` label, which gets reworded. */
  const act = async (id, status, actionTaken, enforcement) => {
    const note = window.prompt('Internal note (optional):');
    let updated;
    try {
      updated = await triageReport(id, { status, note: note || actionTaken, actionTaken, enforcement });
    } catch {
      toast('That decision could not be saved. Please reload the queue.', 'error');
      return;
    }
    // No client audit/note: ReportService.triage writes the audit row; the server's `status` is authoritative
    // (`resolved` stores as `dismissed`).
    const saved = updated?.status || status;
    const resolveAction = (existing) => (status === 'open' ? '' : (actionTaken || existing));
    setAll((prev) => prev.map((r) => r.id === id ? { ...r, status: saved, actionTaken: resolveAction(r.actionTaken), handledAt: Date.now() } : r));
    if (detail?.id === id) setDetail((d) => ({ ...d, status: saved, actionTaken: resolveAction(d.actionTaken), handledAt: Date.now() }));
    toast(actionTaken || (status === 'open' ? 'Reopened' : saved));
  };

  /** No bulk endpoint, so N requests: `allSettled` so one
   * refusal doesn't abandon the rest, then a single re-read.  */
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

  const undecided = useMemo(() => {
    const list = (all || []).filter(canTriage);
    return Object.fromEntries(TABS.map((t) => [t.key, list.filter((r) => inTab(r, t.key)).length]));
  }, [all]);

  const tabRows = useMemo(() => (all || []).filter((r) => inTab(r, tab)), [all, tab]);
  const statusChips = STATUS_OPTS.map((o) => ({
    value: o.value,
    label: `${o.value ? o.label : 'All'} ${fmtNum(o.value ? tabRows.filter((r) => r.status === o.value).length : tabRows.length)}`,
  }));

  const rows = useMemo(() => {
    let list = tabRows;
    if (statusF) list = list.filter((r) => r.status === statusF);
    if (activeReason) list = list.filter((r) => r.reason === activeReason);
    if (dateRange) {
      const cutoff = Date.now() - Number(dateRange) * 86400000;
      list = list.filter((r) => r.at >= cutoff);
    }
    if (q) { const n = q.toLowerCase(); list = list.filter((r) => JSON.stringify(r).toLowerCase().includes(n)); }
    return list;
  }, [tabRows, statusF, activeReason, dateRange, q]);

  const hasFilters = statusF || activeReason || dateRange || q;
  const clearFilters = () => { setStatusF(''); setReasonF(''); setDateRange(''); setQ(''); };
  const page = useClientPaging(rows, PAGE_SIZE, `${tab}|${statusF}|${activeReason}|${dateRange}|${q}`);

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

  const triageButtons = (r) => (canTriage(r) ? (
    <>
      {inTab(r, 'listings')
        ? <button type="button" onClick={() => act(r.id, 'actioned', 'Listing taken down', 'hide_content')} className={BTN.danger}><Ban className="h-3.5 w-3.5" />Take down</button>
        : inTab(r, 'posts')
          /* `hide_content`, not `suspend_account`: a flatmate post is content, and suspending its author is a heavier decision. */
          ? <button type="button" onClick={() => act(r.id, 'actioned', 'Post taken down', 'hide_content')} className={BTN.danger}><Ban className="h-3.5 w-3.5" />Take down</button>
          : <button type="button" onClick={() => act(r.id, 'actioned', 'User suspended', 'suspend_account')} className={BTN.danger}><Ban className="h-3.5 w-3.5" />Suspend</button>}
      <button type="button" onClick={() => act(r.id, 'resolved', 'Reviewed, no action needed')} className="dz-btn dz-btn-primary dz-btn-sm"><CheckCircle2 className="h-3.5 w-3.5" />Resolve</button>
      <button type="button" onClick={() => act(r.id, 'dismissed')} className="dz-btn dz-btn-ghost dz-btn-sm"><XCircle className="h-3.5 w-3.5" />Dismiss</button>
    </>
  ) : (
    /* No Reopen: a decided report is terminal server-side, and reopening would let a moderator quietly undo a colleague's decision. */
    <span className="py-1 text-xs text-gray-500" title="A decided report cannot be reopened — file a new one if it recurs">Decided</span>
  ));

  const reportRow = (r) => {
    const repeatCount = targetCounts[r.targetId] || 1;
    const titled = r.targetTitle && r.targetTitle !== r.targetId;
    return (
      <RowCard
        key={r.id}
        id={r.id}
        selected={selected.has(r.id)}
        lead={r.status === 'open' ? (
          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} className="h-4 w-4 shrink-0 rounded accent-teal-400" aria-label="Select report" />
        ) : null}
        title={r.targetTitle || r.targetId || '—'}
        badges={(
          <>
            <Badge status={r.status} />
            {repeatCount >= 3 ? (
              <span className={classNames(CHIP, CHIP_TONE.red, 'gap-0.5')} title={`${repeatCount} reports on this target`}>
                <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />{repeatCount}x
              </span>
            ) : null}
          </>
        )}
        meta={(
          <>
            <span>{KIND_LABEL[r.kind] || r.kind}</span>
            {titled ? <><span className="text-gray-600" aria-hidden="true">·</span><span className="truncate text-gray-500">{r.targetId}</span></> : null}
          </>
        )}
        facts={(
          <>
            <FactRow label="Reason">
              <Cell className="font-medium text-gray-200 md:col-span-2">{r.reasonLabel}</Cell>
              <Cell className="tabular-nums">{fmtDate(r.at)}</Cell>
              {r.actionTaken ? <Cell className="text-emerald-300">{r.actionTaken}</Cell> : null}
            </FactRow>
            {r.details ? (
              <FactRow label="Note">
                <span className="col-span-2 text-gray-300 md:col-span-4">{r.details}</span>
              </FactRow>
            ) : null}
            {/* "Withheld", not "Anonymous": the platform knows who filed this; ops is not told. */}
            <FactRow label="People">
              <Cell>{`Reporter: ${r.reportedBy || 'Withheld'}`}</Cell>
              {r.reporterMobile ? <Cell className="tabular-nums">{r.reporterMobile}</Cell> : null}
              {r.targetOwner ? <Cell className="md:col-span-2">{`Owner: ${r.targetOwner}${r.ownerMobile ? ` · ${r.ownerMobile}` : ''}`}</Cell> : null}
            </FactRow>
          </>
        )}
        primary={triageButtons(r)}
        icons={<IconAction label="View details" onClick={() => setDetail(r)} icon={Eye} />}
      />
    );
  };
  const doExport = () => exportCsv(
    `draazy-reports-${tab}.csv`,
    ['ID', 'Kind', 'Target', 'Reason', 'Reporter', 'Reported', 'Status', 'Action Taken'],
    // Same "Withheld" as every on-screen surface. A blank cell in an exported sheet is read as
    // missing data rather than as withheld data, which is the ambiguity the wording exists to avoid.
    rows.map((r) => [r.id, r.kind, r.targetTitle || r.targetId, r.reasonLabel, r.reportedBy || 'Withheld', fmtDate(r.at), r.status, r.actionTaken || '']),
  );

  const tabs = [
    ...TABS.map((t) => ({ key: t.key, label: t.label, count: undecided[t.key] })),
    ...(canSeeReviews ?  [{ key: 'reviews', label: 'Reviews', count: null }] : []),
  ];
  const openInView = rows.filter((r) => r.status === 'open');
  const allOpenSelected = openInView.length > 0 && selected.size === openInView.length;

  return (
    <div className="pb-20">
      <PageHeader
        title="Reports & Moderation"
        subtitle="Review reported properties, users and posts, moderate reviews, and take action."
        actions={tab !== 'reviews' ? <button type="button" onClick={doExport} className="dz-btn dz-btn-ghost"><Download className="h-4 w-4" />Export CSV</button> : null}
      />

      <QueueTabs label="Report queues" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'reviews' ? <ReviewsTab /> : (
        <QueuePanel
          active={tab}
          note={NOTES[tab]}
          noteTestId={`${tab}-note`}
          toolbar={(
            <>
              <SearchBox value={q} onChange={setQ} placeholder="Item, reason or note" label="Search reports" />
              <Chips label="Status" options={statusChips} value={statusF} onChange={setStatusF} />
              {/* `searchable={false}`: `Select` turns itself into a search combobox at eight options and
                  autofocuses the input, which on mobile summons the keyboard over eight items. */}
              <div className="w-56"><Select value={activeReason} onChange={setReasonF} options={reasonOpts} searchable={false} ariaLabel="Filter by reason" size="sm" /></div>
              <Chips label="Reported" options={DATE_CHIPS} value={dateRange} onChange={setDateRange} />
              {hasFilters ? <ClearFilters onClick={clearFilters} /> : null}
              <div className="ml-auto"><PageNav {...page.paging} /></div>
            </>
          )}
          footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
        >
          {openInView.length ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2 text-xs text-gray-400">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={allOpenSelected} onChange={toggleAll} className="h-4 w-4 rounded accent-teal-400" />
                Select all open ({fmtNum(openInView.length)})
              </label>
              {selected.size > 0 ? (
                <>
                  <span className="font-medium text-teal-200">{selected.size} selected</span>
                  <button type="button" onClick={bulkResolve} className="dz-btn dz-btn-primary dz-btn-sm"><CheckCircle2 className="h-3.5 w-3.5" /> Bulk Resolve</button>
                  <button type="button" onClick={bulkDismiss} className="dz-btn dz-btn-ghost dz-btn-sm"><XCircle className="h-3.5 w-3.5" /> Bulk Dismiss</button>
                  <button type="button" onClick={() => setSelected(new Set())} className="ml-auto hover:text-white">Deselect all</button>
                </>
              ) : null}
            </div>
          ) : null}
          <RowList isEmpty={!rows.length} empty={hasFilters ? 'No reports match these filters.' : 'All clear — nothing reported here.'}>
            {page.items.map(reportRow)}
          </RowList>
        </QueuePanel>
      )}

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
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              {triageButtons(detail)}
              <button onClick={() => setDetail(null)} className="dz-btn dz-btn-primary ml-auto">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
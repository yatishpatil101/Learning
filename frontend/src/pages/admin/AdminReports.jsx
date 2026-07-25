import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Ban, Building2, CheckCircle2, Download, Eye, Flag, RotateCcw, Search, UserX, XCircle } from 'lucide-react';
import { listReports, mutateDb, logAudit, addInternalNote } from '../../lib/mockApi.js';
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

const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'actioned', label: 'Action taken' },
  { value: 'dismissed', label: 'Dismissed' },
];

const REASON_OPTS = [
  { value: '', label: 'All reasons' },
  { value: 'fake', label: 'Fake / Duplicate' },
  { value: 'inaccurate', label: 'Inaccurate info' },
  { value: 'fraud', label: 'Fraud / Scam' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'offensive', label: 'Offensive' },
  { value: 'spam', label: 'Spam' },
];

function updateReport(id, patch) {
  mutateDb((db) => { const r = (db.reports || []).find((x) => x.id === id); if (r) Object.assign(r, patch); });
}

export default function AdminReports() {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const [searchParams] = useSearchParams();
  const [all, setAll] = useState(null);
  const [tab, setTab] = useTabParam(['listings', 'users'], 'listings');
  const [statusF, setStatusF] = useState('');
  const [reasonF, setReasonF] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const load = () => listReports().then((r) => setAll(r));
  useEffect(() => { let alive = true; load().then(() => !alive); return () => { alive = false; }; }, []); // eslint-disable-line

  // Deep-link ?open=<id>
  useEffect(() => {
    if (!all) return;
    const oid = searchParams.get('open');
    if (oid) { const r = all.find((x) => x.id === oid); if (r) setDetail(r); }
  }, [all, searchParams]); // eslint-disable-line

  const act = (id, status, actionTaken) => {
    const note = window.prompt('Internal note (optional):');
    const patch = { status, handledAt: Date.now() };
    if (actionTaken !== undefined) patch.actionTaken = actionTaken;
    if (status === 'open') patch.actionTaken = '';
    updateReport(id, patch);
    if (note) addInternalNote('report', id, note, actionTaken || status);
    logAudit('Reports', `${status} report ${id}`);
    // Mirror the persisted patch exactly: reopening clears the action, an
    // explicit action overwrites it, otherwise the existing value is kept.
    const resolveAction = (existing) => (status === 'open' ? '' : (actionTaken || existing));
    setAll((prev) => prev.map((r) => r.id === id ? { ...r, status, actionTaken: resolveAction(r.actionTaken), handledAt: Date.now() } : r));
    if (detail?.id === id) setDetail((d) => ({ ...d, status, actionTaken: resolveAction(d.actionTaken), handledAt: Date.now() }));
    toast(actionTaken || (status === 'open' ? 'Reopened' : status));
  };

  const bulkResolve = () => {
    if (!selected.size) return;
    if (!window.confirm(`Resolve ${selected.size} report(s) as "Reviewed, no action needed"?`)) return;
    for (const id of selected) {
      updateReport(id, { status: 'resolved', actionTaken: 'Bulk resolved', handledAt: Date.now() });
    }
    logAudit('Reports', `Bulk resolved ${selected.size} reports`);
    setAll((prev) => prev.map((r) => selected.has(r.id) ? { ...r, status: 'resolved', actionTaken: 'Bulk resolved', handledAt: Date.now() } : r));
    setSelected(new Set());
    toast(`${selected.size} reports resolved`);
  };

  const bulkDismiss = () => {
    if (!selected.size) return;
    if (!window.confirm(`Dismiss ${selected.size} report(s)?`)) return;
    for (const id of selected) {
      updateReport(id, { status: 'dismissed', handledAt: Date.now() });
    }
    logAudit('Reports', `Bulk dismissed ${selected.size} reports`);
    setAll((prev) => prev.map((r) => selected.has(r.id) ? { ...r, status: 'dismissed', handledAt: Date.now() } : r));
    setSelected(new Set());
    toast(`${selected.size} reports dismissed`);
  };

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
      listings: list.filter((r) => r.kind === 'listing').length,
      users: list.filter((r) => r.kind === 'user').length,
      closed: list.filter((r) => r.status !== 'open').length,
    };
  }, [all]);

  const rows = useMemo(() => {
    let list = (all || []).filter((r) => tab === 'listings' ? r.kind === 'listing' : r.kind === 'user');
    if (statusF) list = list.filter((r) => r.status === statusF);
    if (reasonF) list = list.filter((r) => r.reason === reasonF);
    if (dateRange) {
      const cutoff = Date.now() - Number(dateRange) * 86400000;
      list = list.filter((r) => r.at >= cutoff);
    }
    if (q) { const n = q.toLowerCase(); list = list.filter((r) => JSON.stringify(r).toLowerCase().includes(n)); }
    return list;
  }, [all, tab, statusF, reasonF, dateRange, q]);

  const hasFilters = statusF || reasonF || dateRange || q;
  const clearFilters = () => { setStatusF(''); setReasonF(''); setDateRange(''); setQ(''); };

  // Reset selection when filters or tab change
  useEffect(() => { setSelected(new Set()); }, [tab, statusF, reasonF, dateRange, q]);

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
      {r.status === 'open' ? (
        <>
          {tab === 'listings'
            ? <button onClick={() => act(r.id, 'actioned', 'Listing taken down')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300" title="Take down"><Ban className="mr-0.5 inline h-3 w-3" />Take down</button>
            : <button onClick={() => act(r.id, 'actioned', 'User suspended')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300" title="Suspend user"><Ban className="mr-0.5 inline h-3 w-3" />Suspend</button>}
          <button onClick={() => act(r.id, 'resolved', 'Reviewed, no action needed')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal" title="Resolve"><CheckCircle2 className="mr-0.5 inline h-3 w-3" />Resolve</button>
          <button onClick={() => act(r.id, 'dismissed')} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5" title="Dismiss"><XCircle className="mr-0.5 inline h-3 w-3" />Dismiss</button>
        </>
      ) : (
        <button onClick={() => act(r.id, 'open')} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5" title="Reopen"><RotateCcw className="mr-0.5 inline h-3 w-3" />Reopen</button>
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
      header: tab === 'listings' ? 'Property' : 'User / Owner',
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
      header: 'Reported by',
      render: (r) => (
        <div>
          <div>{r.reportedBy || 'Anonymous'}</div>
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
          <span className="truncate">By {r.reportedBy || 'Anonymous'}{r.reporterMobile ? ` · ${r.reporterMobile}` : ''}</span>
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
    rows.map((r) => [r.id, r.kind, r.targetTitle || r.targetId, r.reasonLabel, r.reportedBy, fmtDate(r.at), r.status, r.actionTaken || '']),
  );

  const KPIS = [
    { label: 'Open reports', value: fmtNum(kpis.open), icon: Flag, clickTab: null, color: 'text-amber-400' },
    { label: 'Reported properties', value: fmtNum(kpis.listings), icon: Building2, clickTab: 'listings', color: 'text-brand-teal' },
    { label: 'Reported users', value: fmtNum(kpis.users), icon: UserX, clickTab: 'users', color: 'text-rose-400' },
    { label: 'Closed', value: fmtNum(kpis.closed), icon: CheckCircle2, clickTab: null, color: 'text-emerald-400' },
  ];

  return (
    <div>
      <PageHeader
        title="Reports & Moderation"
        subtitle="Review reported properties and users, and take action."
        actions={<button onClick={doExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" />Export CSV</button>}
      />

      {/* KPI tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        {[['listings', 'Reported properties', kpis.listings, 'reports.properties'], ['users', 'Reported users & owners', kpis.users, 'reports.users']].map(([id, label, count, flag]) => (
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
              <Select value={statusF} onChange={setStatusF} options={STATUS_OPTS} ariaLabel="Filter by status" />
            </div>
            <div className="w-1/2">
              <Select value={reasonF} onChange={setReasonF} options={REASON_OPTS} ariaLabel="Filter by reason" />
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
          <span className="text-xs text-gray-500 ml-auto">{rows.length} of {(all || []).filter((r) => tab === 'listings' ? r.kind === 'listing' : r.kind === 'user').length}</span>
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
                ['Reported by', detail.reportedBy || 'Anonymous'],
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
              {detail.status === 'open' ? (
                <>
                  {detail.kind === 'listing'
                    ? <button onClick={() => act(detail.id, 'actioned', 'Listing taken down')} className="pn-btn pn-btn-ghost text-red-300"><Ban className="h-4 w-4" />Take down</button>
                    : <button onClick={() => act(detail.id, 'actioned', 'User suspended')} className="pn-btn pn-btn-ghost text-red-300"><Ban className="h-4 w-4" />Suspend</button>}
                  <button onClick={() => act(detail.id, 'resolved', 'Reviewed, content kept')} className="pn-btn pn-btn-ghost"><CheckCircle2 className="h-4 w-4" />Resolve</button>
                  <button onClick={() => act(detail.id, 'dismissed')} className="pn-btn pn-btn-ghost text-gray-300"><XCircle className="h-4 w-4" />Dismiss</button>
                </>
              ) : (
                <button onClick={() => act(detail.id, 'open')} className="pn-btn pn-btn-ghost"><RotateCcw className="h-4 w-4" />Reopen</button>
              )}
              <button onClick={() => setDetail(null)} className="pn-btn pn-btn-primary ml-auto">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
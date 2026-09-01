import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Award, Building2, ExternalLink, Search, TrendingUp, X } from 'lucide-react';
import { listStaffActivity, getStaffActivitySummary } from '../../services/staffActivityService.js';
import { classNames, fmtNum, timeAgo } from '../../lib/format.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Select from '../../components/ui/Select.jsx';
import Badge from '../../components/ui/Badge.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';

/**
 * The back-office review surface: who did what, and how much of it.
 *
 * Everything on this page is now counted by the server. That is the whole change. The version this
 * replaces read a parallel activity log the frontend wrote to localStorage, filtered it in memory,
 * and folded its own KPI tiles and leaderboard out of the rows it happened to have — so "total
 * activities" meant "rows in this tab", and the leaderboard ranked the current page rather than the
 * team. Those were not display bugs. They were the wrong numbers, printed confidently, on the page
 * used to judge colleagues.
 *
 * Two reads, both administrator-only under `audit:read`:
 *   - the feed, paged, one row per audited back-office action
 *   - the summary: totals, the per-entity split, the action vocabulary, the leaderboard
 *
 * The summary is asked twice on purpose — see `refresh` below.
 */

const PAGE_SIZE = 50;

/** The category filter's colours, keyed by the server's `entity`. Anything unlisted is grey. */
const ENTITY_COLOR = {
  user: 'teal',
  property: 'indigo',
  ticket: 'purple',
  locality: 'amber',
  societyLead: 'blue',
  settings: 'rose',
};

const entityColor = (entity) => ENTITY_COLOR[entity] || 'gray';

/** `user.staff.approve.refused` → `staff approve refused`. The noun is already the category. */
const readableAction = (action) => String(action || '').split('.').slice(1).join(' ') || action;

export default function AdminStaffActivity() {
  const { optionEnabled, loading: flagsLoading } = useAdminFlags();

  const [rows, setRows] = useState(null);
  const [pageInfo, setPageInfo] = useState({ page: 0, totalPages: 1, total: 0 });
  /** Headline totals for the *narrowed* window: what the page is actually showing. */
  const [headline, setHeadline] = useState({ total: 0, staffCount: 0, byEntity: [] });
  /** Options and ranking for the *unnarrowed* window, so the pickers keep offering every choice. */
  const [facets, setFacets] = useState({ actions: [], byEntity: [], leaderboard: [] });
  const [error, setError] = useState('');

  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [days, setDays] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const from = days ? new Date(Date.now() - Number(days) * 86400000).toISOString() : undefined;

  /**
   * Three requests, and each one answers a different question.
   *
   * The feed and the headline take the full filter, because a console narrowed to one colleague
   * should not sit under a total for the whole platform. The facets take only the date range and the
   * search term, because a picker built from the narrowed window would delete its own options the
   * moment you used it — choose "user" and `byEntity` comes back holding nothing but "user", so
   * there is no way back to anything else. The leaderboard rides with the facets for the same
   * reason: it doubles as the staff picker, and a ranking of one person cannot pick a second.
   */
  const refresh = useCallback(async () => {
    const filter = { actor, entity, action, from, q };
    const open = { from, q };
    setError('');
    try {
      const [feed, narrow, wide] = await Promise.all([
        listStaffActivity({ ...filter, page, size: PAGE_SIZE }),
        getStaffActivitySummary(filter),
        getStaffActivitySummary(open),
      ]);
      if (!alive.current) return;
      setRows(feed.items);
      setPageInfo({ page: feed.page, totalPages: feed.totalPages, total: feed.total });
      setHeadline({ total: narrow.total, staffCount: narrow.staffCount, byEntity: narrow.byEntity });
      setFacets({ actions: wide.actions, byEntity: wide.byEntity, leaderboard: wide.leaderboard });
    } catch (err) {
      if (!alive.current) return;
      setRows([]);
      setError(err?.message || 'Could not load staff activity.');
    }
  }, [actor, entity, action, from, q, page]);

  /* Debounced because `q` changes on every keystroke and each change is three requests. */
  useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  /* Any change to the filters is a different result set, so page 1 is the only honest place to be. */
  useEffect(() => { setPage(0); }, [actor, entity, action, days, q]);

  const staffOpts = [
    { value: '', label: 'All staff' },
    ...facets.leaderboard.map((s) => ({ value: s.actor, label: s.name })),
  ];
  const entityOpts = [
    { value: '', label: 'All categories' },
    ...facets.byEntity.map((b) => ({ value: b.entity, label: b.entity })),
  ];
  const actionOpts = [
    { value: '', label: 'All actions' },
    ...facets.actions.map((a) => ({ value: a, label: readableAction(a) })),
  ];

  const hasFilters = actor || entity || action || days || q;
  const clearFilters = () => { setActor(''); setEntity(''); setAction(''); setDays(''); setQ(''); };

  const columns = [
    {
      key: 'staff',
      header: 'Staff Member',
      render: (a) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-300">
            {(a.actorName || '?').charAt(0)}
          </div>
          <div>
            <div className="text-sm font-medium text-white">{a.actorName}</div>
            <div className="text-[11px] text-gray-500 capitalize">
              {a.actorTeam ? `${a.actorTeam} team` : a.actorRole}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (a) => (
        <div className="flex flex-col gap-1">
          <Badge color={entityColor(a.entity)}>{a.entity}</Badge>
          <span className="text-[11px] text-gray-500">{readableAction(a.action)}</span>
        </div>
      ),
    },
    {
      key: 'detail',
      header: 'Record',
      /* The mock printed a prose `detail` written in the browser at the moment of the action. There
         is no such sentence on the server and one is not invented here: what identifies the record
         is its id, and a caption assembled by the reader is not evidence. */
      render: (a) => (
        <span className="font-mono text-xs text-gray-400">{a.entityId || '—'}</span>
      ),
    },
    {
      key: 'link',
      header: '',
      className: 'w-10',
      render: (a) => (a.entity === 'property' ? (
        <Link to="/admin/properties" className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 hover:text-white transition" title="View in Properties">
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      ) : null),
    },
    {
      key: 'when',
      header: 'When',
      className: 'text-gray-400 whitespace-nowrap text-right',
      render: (a) => <span className="text-xs">{timeAgo(a.at)}</span>,
    },
  ];

  const activityCard = (a) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-300">
            {(a.actorName || '?').charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{a.actorName}</div>
            <div className="text-[11px] text-gray-500 capitalize">
              {a.actorTeam ? `${a.actorTeam} team` : a.actorRole}
            </div>
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">{timeAgo(a.at)}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Badge color={entityColor(a.entity)}>{a.entity}</Badge>
        <span className="text-[11px] text-gray-500">{readableAction(a.action)}</span>
      </div>
      <div className="mt-2 font-mono text-xs text-gray-400">{a.entityId || '—'}</div>
    </div>
  );

  if (flagsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
      </div>
    );
  }

  if (!optionEnabled('staffActivity.enabled')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-gray-500 text-sm">Staff Activity module is disabled.</div>
        <Link to="/admin/settings" className="mt-2 text-brand-teal text-sm hover:underline">Enable in Settings &rarr;</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Staff Activity"
        subtitle="Every back-office action on the record, counted by the server"
        actions={
          <Link to="/admin/properties" className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 transition">
            <Building2 className="h-4 w-4" /> Staff Posted Tab
          </Link>
        }
      />

      <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-sm text-gray-400">
          Chasing one record rather than one colleague?{' '}
          <Link to="/admin/settings" className="text-brand-teal hover:underline font-medium">
            &rarr; View Audit Log
          </Link>
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* KPI summary row. Two facts the server counts, then the busiest kinds of record in the
          window — rather than the old page's two hardcoded tiles, which named 'listings' and
          'services' whether or not either had happened. */}
      {optionEnabled('staffActivity.kpis') && (
      <div className="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div data-testid="kpi-total" className="text-2xl font-bold text-white">{fmtNum(headline.total)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total activities</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div data-testid="kpi-staff" className="text-2xl font-bold text-amber-400">{fmtNum(headline.staffCount)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Active staff</div>
        </div>
        {headline.byEntity.slice(0, 2).map((b) => (
          <div key={b.entity} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-2xl font-bold text-teal-400">{fmtNum(b.count)}</div>
            <div className="text-xs text-gray-500 mt-0.5 capitalize">{b.entity} actions</div>
          </div>
        ))}
      </div>
      )}

      {/* Leaderboard */}
      {optionEnabled('staffActivity.leaderboard') && (
      <div className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 mb-3">
          <Award className="h-4 w-4 text-amber-400" /> Staff Leaderboard
        </h2>
        {facets.leaderboard.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {facets.leaderboard.map((s, i) => (
              <button
                key={s.actor}
                onClick={() => setActor(actor === s.actor ? '' : s.actor)}
                aria-pressed={actor === s.actor}
                className={classNames(
                  'rounded-xl border p-4 transition text-left',
                  actor === s.actor ? 'border-teal-400/50 bg-teal-500/10 ring-1 ring-teal-400/20' :
                  i === 0 ? 'border-amber-500/30 bg-amber-500/5 hover:border-amber-400/50' :
                  'border-white/10 bg-white/[0.02] hover:border-white/20',
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={classNames(
                    'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold',
                    i === 0 ? 'bg-amber-500/20 text-amber-300' :
                    i === 1 ? 'bg-gray-400/20 text-gray-300' :
                    i === 2 ? 'bg-orange-500/15 text-orange-300' :
                    'bg-white/10 text-gray-400',
                  )}>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{s.name}</div>
                    <div className="text-[11px] text-gray-500 capitalize">
                      {s.team ? `${s.team} team` : s.role}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  {/* Volume, deliberately labelled as such. An audit row records that something was
                      done, not that it was done well — the old page filed the same number under
                      "performance", which this data cannot support. */}
                  <span className="flex items-center gap-1 text-teal-400">
                    <TrendingUp className="h-3 w-3" /> {fmtNum(s.total)} actions
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No activity recorded in this window.</p>
        )}
      </div>
      )}

      {/* Filters bar */}
      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search staff, action or record…"
            aria-label="Search staff activity"
            className="dz-input w-full"
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
            <Select value={actor} onChange={setActor} options={staffOpts} ariaLabel="Filter by staff" />
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
            <Select value={entity} onChange={setEntity} options={entityOpts} ariaLabel="Filter by category" />
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
            <Select value={action} onChange={setAction} options={actionOpts} ariaLabel="Filter by action" />
          </div>
          <DateRangePills value={days} onChange={setDays} />
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10 transition">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
          <span className="ml-auto text-xs text-gray-500 tabular-nums">
            {rows === null ? 'Loading…' : `${fmtNum(rows.length)} of ${fmtNum(pageInfo.total)}`}
          </span>
        </div>
      </div>

      {/* Activity table. No `pageSize`: these rows are one server page already, and slicing them
          again in the browser would put a pager under a pager, each counting something different. */}
      <Table
        columns={columns}
        rows={rows || []}
        label="activities"
        empty={rows === null ? 'Loading…' : 'No staff activity in this window.'}
        mobileCard={activityCard}
      />

      {pageInfo.totalPages > 1 && (
        <nav aria-label="Activity pages" className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={pageInfo.page === 0}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5 transition"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500 tabular-nums">
            Page {pageInfo.page + 1} of {fmtNum(pageInfo.totalPages)}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageInfo.totalPages - 1, p + 1))}
            disabled={pageInfo.page >= pageInfo.totalPages - 1}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5 transition"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

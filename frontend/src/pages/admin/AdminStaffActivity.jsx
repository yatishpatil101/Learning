import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Award, Building2, ExternalLink, Search, TrendingUp, X } from 'lucide-react';
import { listStaffActivity, getStaffStats } from '../../lib/mockApi.js';
import { classNames, fmtNum, timeAgo } from '../../lib/format.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Select from '../../components/ui/Select.jsx';
import Badge from '../../components/ui/Badge.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';

const CATEGORY_OPTS = [
  { value: '', label: 'All categories' },
  { value: 'listing', label: 'Listings' },
  { value: 'service', label: 'Services' },
];

const ACTION_OPTS = [
  { value: '', label: 'All actions' },
  { value: 'post-on-behalf', label: 'Post on Behalf' },
  { value: 'rent-agreement', label: 'Rent Agreement' },
  { value: 'interior', label: 'Interior' },
  { value: 'legal', label: 'Legal' },
  { value: 'packers', label: 'Packers' },
  { value: 'valuation', label: 'Valuation' },
];

const categoryColor = (cat) => {
  if (cat === 'listing') return 'teal';
  if (cat === 'service') return 'purple';
  return 'gray';
};

export default function AdminStaffActivity() {
  const { optionEnabled, loading: flagsLoading } = useAdminFlags();
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStaff, setFilterStaff] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterTime, setFilterTime] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([listStaffActivity(), getStaffStats()])
      .then(([a, s]) => { setActivity(a); setStats(s); })
      .finally(() => setLoading(false));
  }, []);

  const staffOpts = useMemo(() => {
    const names = [...new Set(activity.map((a) => a.staffName))];
    return [{ value: '', label: 'All staff' }, ...names.map((n) => ({ value: n, label: n }))];
  }, [activity]);

  const filtered = useMemo(() => {
    let list = activity;
    if (filterStaff) list = list.filter((a) => a.staffName === filterStaff);
    if (filterCategory) list = list.filter((a) => a.category === filterCategory);
    if (filterAction) list = list.filter((a) => a.action === filterAction);
    if (filterTime) {
      const cutoff = Date.now() - Number(filterTime) * 86400000;
      list = list.filter((a) => new Date(a.at).getTime() >= cutoff);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) => (a.staffName + a.detail + a.action + a.category).toLowerCase().includes(q));
    }
    return list;
  }, [activity, filterStaff, filterCategory, filterAction, filterTime, search]);

  const hasFilters = filterStaff || filterCategory || filterAction || filterTime || search;
  const clearFilters = () => { setFilterStaff(''); setFilterCategory(''); setFilterAction(''); setFilterTime(''); setSearch(''); };

  const columns = [
    {
      key: 'staff',
      header: 'Staff Member',
      render: (a) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-300">
            {(a.staffName || '?').charAt(0)}
          </div>
          <div>
            <div className="text-sm font-medium text-white">{a.staffName}</div>
            {a.staffTeam && <div className="text-[11px] text-gray-500 capitalize">{a.staffTeam} team</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (a) => (
        <div className="flex flex-col gap-1">
          <Badge color={categoryColor(a.category)}>{a.category}</Badge>
          <span className="text-[11px] text-gray-500">{a.action}</span>
        </div>
      ),
    },
    {
      key: 'detail',
      header: 'Detail',
      render: (a) => (
        <div className="max-w-[320px]">
          <span className="text-sm text-gray-200 line-clamp-2">{a.detail}</span>
        </div>
      ),
    },
    {
      key: 'link',
      header: '',
      className: 'w-10',
      render: (a) => {
        if (a.listingId) {
          return (
            <Link to="/admin/properties" className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 hover:text-white transition" title="View in Properties">
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          );
        }
        return null;
      },
    },
    {
      key: 'when',
      header: 'When',
      className: 'text-gray-400 whitespace-nowrap text-right',
      render: (a) => <span className="text-xs">{timeAgo(a.at)}</span>,
    },
  ];

  const activityCard = (a) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-300">
            {(a.staffName || '?').charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{a.staffName}</div>
            {a.staffTeam && <div className="text-[11px] text-gray-500 capitalize">{a.staffTeam} team</div>}
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">{timeAgo(a.at)}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Badge color={categoryColor(a.category)}>{a.category}</Badge>
        <span className="text-[11px] text-gray-500">{a.action}</span>
      </div>
      <div className="mt-2 text-sm text-gray-200">{a.detail}</div>
      {a.listingId ? (
        <Link to="/admin/properties" className="mt-3 inline-flex items-center gap-1.5 border-t border-white/5 pt-3 text-xs text-brand-teal hover:underline">
          <ExternalLink className="h-3.5 w-3.5" /> View in Properties
        </Link>
      ) : null}
    </div>
  );


  if (loading || flagsLoading) {
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
        subtitle="Track staff performance — listings posted, services handled & more"
        actions={
          <Link to="/admin/properties" className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 transition">
            <Building2 className="h-4 w-4" /> Staff Posted Tab
          </Link>
        }
      />

      <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-sm text-gray-400">
          Looking for admin config changes?{' '}
          <Link to="/admin/settings" className="text-brand-teal hover:underline font-medium">
            &rarr; View Audit Log
          </Link>
        </p>
      </div>

      {/* KPI summary row */}
      {optionEnabled('staffActivity.kpis') && (
      <div className="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-white">{fmtNum(activity.length)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total activities</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-teal-400">{fmtNum(activity.filter((a) => a.category === 'listing').length)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Listings posted</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-purple-400">{fmtNum(activity.filter((a) => a.category === 'service').length)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Services handled</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-amber-400">{stats.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Active staff</div>
        </div>
      </div>
      )}


      {/* Leaderboard */}
      {optionEnabled('staffActivity.leaderboard') && (
      <div className="mb-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 mb-3">
          <Award className="h-4 w-4 text-amber-400" /> Staff Leaderboard
        </h2>
        {stats.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {stats.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setFilterStaff(filterStaff === s.name ? '' : s.name)}
                className={classNames(
                  'rounded-xl border p-4 transition text-left',
                  filterStaff === s.name ? 'border-teal-400/50 bg-teal-500/10 ring-1 ring-teal-400/20' :
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
                    {s.team && <div className="text-[11px] text-gray-500 capitalize">{s.team} team</div>}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1 text-teal-400">
                    <TrendingUp className="h-3 w-3" /> {s.total} total
                  </span>
                  {s.listings > 0 && <span className="text-gray-400">{s.listings} listings</span>}
                  {s.services > 0 && <span className="text-gray-400">{s.services} services</span>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No activity recorded yet. Staff actions will appear here.</p>
        )}
      </div>
      )}

      {/* Filters bar */}
      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="pn-input w-full" style={{ paddingLeft: '2.25rem' }} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
            <Select value={filterStaff} onChange={setFilterStaff} options={staffOpts} ariaLabel="Filter by staff" />
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
            <Select value={filterCategory} onChange={setFilterCategory} options={CATEGORY_OPTS} ariaLabel="Filter by category" />
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
            <Select value={filterAction} onChange={setFilterAction} options={ACTION_OPTS} ariaLabel="Filter by action" />
          </div>
          <DateRangePills value={filterTime} onChange={setFilterTime} />
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10 transition">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
          <span className="ml-auto text-xs text-gray-500 tabular-nums">{filtered.length} of {activity.length}</span>
        </div>
      </div>

      {/* Activity table */}
      <Table columns={columns} rows={filtered} pageSize={15} label="activities" empty="No staff activity recorded yet. Actions from Post on Behalf and services will appear here." mobileCard={activityCard} />
    </div>
  );
}

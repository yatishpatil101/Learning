import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtNum } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import { listLocalities, getLocalityQueue, assignLocality } from '../../services/localityService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, Cell, Chips, ClearFilters, FactRow, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox, useClientPaging,
} from '../../components/admin/WorkQueue.jsx';

const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };
const coordStr = (l) => (l.lat != null && l.lng != null ? `${(+l.lat).toFixed(4)}, ${(+l.lng).toFixed(4)}` : '—');

const NOTES = {
  pending: 'Listings whose typed area matched no locality. Until filed they are missing from locality search, pages and alerts, and cannot be approved. New area? Add it in Content ▸ Localities first.',
  directory: 'Every area search, filters and SEO key off. Add and retire areas in Content ▸ Localities.',
};

/** No Dismiss/Verify: "reviewed, still no locality" leaves a listing live but invisible to locality search. */
export default function AdminLocalities() {
  const { toast } = useToast();
  const [tab, setTab] = useTabParam(['pending', 'directory'], 'pending');
  const [queue, setQueue] = useState({ total: 0, listings: [] });
  const [directory, setDirectory] = useState([]);
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [qu, d] = await Promise.all([getLocalityQueue(), listLocalities()]);
      setQueue(qu);
      setDirectory(d);
    } catch (e) {
      toast(e?.message || 'Could not load localities', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  // The server refuses a deactivated area, so it is not offered.
  const assignable = useMemo(
    () => directory.filter((l) => l.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [directory],
  );

  const needle = q.trim().toLowerCase();
  const pendingRows = queue.listings.filter((l) => (!status || l.status === status)
    && (!needle || [l.title, l.locality, l.id].join(' ').toLowerCase().includes(needle)));
  const dirRows = directory.filter((l) => (!status || (status === 'retired') === (l.active === false))
    && (!needle || [l.name, l.slug].join(' ').toLowerCase().includes(needle)));
  const rows = tab === 'pending' ? pendingRows : dirRows;
  const page = useClientPaging(rows, tab === 'pending' ? 10 : 20, `${tab}|${status}|${q}`);

  const switchTab = (id) => { setTab(id); setStatus(''); setQ(''); };

  const assign = async (row) => {
    const slug = choice[row.id];
    if (!slug) { toast('Pick an area first', 'info'); return; }
    setBusy(row.id);
    try {
      await assignLocality(row.id, slug);
      const name = (assignable.find((l) => l.slug === slug) || {}).name || slug;
      toast(`“${row.title}” filed under ${name}`, 'success');
      await reload();
    } catch (e) {
      toast(e?.message || 'Could not file that listing', 'error');
    } finally {
      setBusy('');
    }
  };

  const assignControl = (row) => (
    <div className="flex w-full flex-wrap items-center justify-end gap-1.5 max-md:justify-start">
      <select
        aria-label={`Locality for ${row.title}`}
        value={choice[row.id] || ''}
        onChange={(e) => setChoice((c) => ({ ...c, [row.id]: e.target.value }))}
        className="dz-input !h-8 min-w-0 flex-1 !py-0 text-xs"
      >
        <option value="">Choose area…</option>
        {assignable.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
      </select>
      <button type="button" onClick={() => assign(row)} disabled={busy === row.id} className={BTN.primary}>
        {busy === row.id ? 'Filing…' : 'Assign'}
      </button>
    </div>
  );

  const liveBadge = (l) => <Badge status={l.active === false ? 'rejected' : 'approved'}>{l.active === false ? 'Retired' : 'Live'}</Badge>;
  const dirCols = [
    { key: 'name', header: 'Locality', render: (l) => <div><div className="font-semibold">{l.name}</div><div className="text-xs text-gray-400">{l.slug}</div></div> },
    { key: 'coords', header: 'Pin', render: (l) => <span className="text-xs text-gray-300">{coordStr(l)}</span> },
    { key: 'listings', header: 'Listings', render: (l) => <span className="text-xs text-gray-300">{fmtNum(l.listingCount || 0)}</span> },
    { key: 'active', header: 'Status', render: liveBadge },
  ];
  const dirCard = (l) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{l.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">{l.slug}</div>
        </div>
        <div className="shrink-0">{liveBadge(l)}</div>
      </div>
      <div className="mt-2.5 text-xs text-gray-400">{coordStr(l)} · {fmtNum(l.listingCount || 0)} listings</div>
    </div>
  );

  const count = (list, pred) => fmtNum(list.filter(pred).length);
  const statusChips = tab === 'pending'
    ? [
      { value: '', label: `All ${fmtNum(queue.listings.length)}` },
      { value: 'approved', label: `Live · unfindable ${count(queue.listings, (l) => l.status === 'approved')}` },
      { value: 'pending', label: `Pending ${count(queue.listings, (l) => l.status === 'pending')}` },
    ]
    : [
      { value: '', label: `All ${fmtNum(directory.length)}` },
      { value: 'live', label: `Live ${count(directory, (l) => l.active !== false)}` },
      { value: 'retired', label: `Retired ${count(directory, (l) => l.active === false)}` },
    ];

  const tabs = [
    { key: 'pending', label: 'Awaiting locality', count: loading ? null : queue.total },
    { key: 'directory', label: 'Directory', count: loading ? null : directory.length },
  ];

  return (
    <div>
      <PageHeader title="Localities" subtitle="File listings the catalogue could not place, and keep the area registry honest." />

      <QueueTabs label="Locality queues" active={tab} onChange={switchTab} tabs={tabs} />

      <QueuePanel
        active={tab}
        note={NOTES[tab]}
        toolbar={(
          <>
            <SearchBox value={q} onChange={setQ} placeholder={tab === 'pending' ? 'Listing or typed area' : 'Locality or slug'} label="Search localities" />
            <Chips label="Status" options={statusChips} value={status} onChange={setStatus} />
            {status || q ? <ClearFilters onClick={() => { setStatus(''); setQ(''); }} /> : null}
            <div className="ml-auto"><PageNav {...page.paging} /></div>
          </>
        )}
        footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
      >
        {/* `queue.total`, not the array: the server caps the list at 200. */}
        {tab === 'pending' && queue.total > queue.listings.length ? (
          <p className="border-b border-white/10 px-4 py-2 text-xs text-amber-300">
            Showing the {fmtNum(queue.listings.length)} most urgent of {fmtNum(queue.total)}. File these and reload for the next batch.
          </p>
        ) : null}
        {loading ? <Loading label="Loading localities…" /> : null}
        {!loading && tab === 'pending' ? (
          <RowList isEmpty={!rows.length} empty={status || q ? 'No listings match these filters.' : 'Nothing awaiting a locality. Every listing is filed under an area buyers can search.'}>
            {page.items.map((l) => (
              <RowCard
                key={l.id}
                id={l.id}
                title={l.title}
                badges={<Badge status={l.status}>{l.status === 'approved' ? 'Live · unfindable' : l.status}</Badge>}
                meta={l.createdAt ? <span>Listed {fmtDate(l.createdAt)}</span> : null}
                facts={(
                  <>
                    {/* What the owner typed is the field that makes the row decidable. */}
                    <FactRow label="Typed">
                      <Cell className="font-medium text-gray-200 md:col-span-2">{l.locality || '— nothing —'}</Cell>
                    </FactRow>
                    <FactRow label="Pin">
                      <Cell className="tabular-nums md:col-span-2">{coordStr(l)}</Cell>
                    </FactRow>
                  </>
                )}
                primary={assignControl(l)}
              />
            ))}
          </RowList>
        ) : null}
        {!loading && tab === 'directory' ? (
          <div className="p-3">
            <Table columns={dirCols} rows={page.items} rowKey={(l) => l.slug} label="localities" empty={status || q ? 'No localities match these filters.' : 'No localities.'} mobileCard={dirCard} />
          </div>
        ) : null}
      </QueuePanel>
    </div>
  );
}

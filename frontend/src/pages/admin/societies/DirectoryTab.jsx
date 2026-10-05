import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import { PageNav, QueuePanel, SearchBox } from '../../../components/admin/WorkQueue.jsx';
import { titleCase, actBtn, PLAIN } from './helpers.jsx';

/** One server page of the directory. `Table` is used without `pageSize` because its client pager resets on `rows.length` and would fight the server pager. */
export default function DirectoryTab({ state, query, onQuery, page, pageSize, onPage, openEdit, note }) {
  const verified = (s) => <Badge status={s.registration && s.conveyance ? 'approved' : 'pending'}>{s.registration && s.conveyance ? 'Verified' : 'Partial'}</Badge>;
  const claim = (s) => <Badge status={s.claimStatus === 'claimed' ? 'approved' : s.claimStatus === 'pending' ? 'pending' : 'muted'}>{s.claimStatus === 'claimed' ? 'Claimed' : s.claimStatus === 'pending' ? 'Pending' : 'Unclaimed'}</Badge>;

  const dirCols = [
    { key: 'name', header: 'Society', render: (s) => <div><div className="font-semibold">{s.name}</div><div className="text-xs text-gray-400">{s.builder} · {s.year}</div></div> },
    { key: 'locality', header: 'Locality', render: (s) => <span className="capitalize">{titleCase(s.localitySlug)}</span> },
    { key: 'verified', header: 'Verified', render: verified },
    { key: 'claim', header: 'Claim', render: claim },
    { key: 'maint', header: 'Maint.', render: (s) => `₹${s.maintenancePerSqft}/sqft` },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (s) => actBtn('Edit', PLAIN, () => openEdit(s)) },
  ];

  const dirCard = (s) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{s.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">{s.builder} · {s.year}</div>
        </div>
        {actBtn('Edit', PLAIN, () => openEdit(s))}
      </div>
      <div className="mt-2 text-xs text-gray-400 capitalize">{titleCase(s.localitySlug)} · ₹{s.maintenancePerSqft}/sqft</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{verified(s)}{claim(s)}</div>
    </div>
  );

  const paging = { page: page + 1, pageCount: Math.max(1, Math.ceil(state.total / pageSize)), total: state.total, size: pageSize, onPage: (p) => onPage(p - 1) };

  return (
    <QueuePanel
      active="directory"
      note={note}
      toolbar={(
        <>
          <SearchBox value={query} onChange={onQuery} placeholder="Society or builder" label="Search societies" />
          {state.status === 'ready' ? <div className="ml-auto"><PageNav {...paging} /></div> : null}
        </>
      )}
      footer={state.status === 'ready' && paging.pageCount > 1 ? <PageNav {...paging} /> : null}
    >
      {state.status === 'loading' ? <Loading label="Loading the directory…" /> : null}
      {state.status === 'error' ? (
        <div role="alert" className="p-8 text-center text-sm text-gray-300">
          The directory could not be loaded. This is not an empty catalogue — nothing was read.
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className="p-3">
          <Table columns={dirCols} rows={state.items} rowKey={(s) => s.slug} label="directory" empty={query ? 'No societies match that search.' : 'No societies.'} mobileCard={dirCard} />
        </div>
      ) : null}
    </QueuePanel>
  );
}

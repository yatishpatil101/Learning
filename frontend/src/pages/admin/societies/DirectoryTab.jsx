import { ChevronLeft, ChevronRight } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import { fmtNum } from '../../../lib/format.js';
import { titleCase, actBtn, PLAIN } from './helpers.jsx';

/**
 * The society directory, one server page at a time.
 *
 * `Table` is used **without** `pageSize`, which is the whole point of the change: its internal
 * pager slices `rows` in the browser and resets to page one whenever `rows.length` changes, so
 * left on it would fight the pager below — every "Next" would fetch page two and then show its
 * first ten rows as page one of two. The rows handed in are already the page.
 *
 * The search box is the compensation for what paging takes away. Twenty rows of 348 is unusable
 * without one, and it could not have existed before: filtering client-side would have meant holding
 * the whole catalogue, which is the thing being retired. It filters on the server over name and
 * builder (`SocietySpecs.browse`), so it finds societies that are not on the current page.
 */
export default function DirectoryTab({ state, query, onQuery, page, pageSize, onPage, openEdit }) {
  const dirCols = [
    { key: 'name', header: 'Society', render: (s) => <div><div className="font-semibold">{s.name}</div><div className="text-xs text-gray-400">{s.builder} · {s.year}</div></div> },
    { key: 'locality', header: 'Locality', render: (s) => <span className="capitalize">{titleCase(s.localitySlug)}</span> },
    { key: 'verified', header: 'Verified', render: (s) => <Badge status={s.registration && s.conveyance ? 'approved' : 'pending'}>{s.registration && s.conveyance ? 'Verified' : 'Partial'}</Badge> },
    { key: 'claim', header: 'Claim', render: (s) => <Badge status={s.claimStatus === 'claimed' ? 'approved' : s.claimStatus === 'pending' ? 'pending' : 'muted'}>{s.claimStatus === 'claimed' ? 'Claimed' : s.claimStatus === 'pending' ? 'Pending' : 'Unclaimed'}</Badge> },
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
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge status={s.registration && s.conveyance ? 'approved' : 'pending'}>{s.registration && s.conveyance ? 'Verified' : 'Partial'}</Badge>
        <Badge status={s.claimStatus === 'claimed' ? 'approved' : s.claimStatus === 'pending' ? 'pending' : 'muted'}>{s.claimStatus === 'claimed' ? 'Claimed' : s.claimStatus === 'pending' ? 'Pending' : 'Unclaimed'}</Badge>
      </div>
    </div>
  );

  const total = state.total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search by society or builder…"
          aria-label="Search societies"
          className="w-full max-w-xs rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-teal-400/50"
        />
        {state.status === 'ready' ? (
          <span className="ml-auto text-xs text-gray-400">
            {total ? `Showing ${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(total)} directory` : 'No societies match that search'}
          </span>
        ) : null}
      </div>

      {state.status === 'loading' ? <Loading label="Loading the directory…" /> : null}

      {state.status === 'error' ? (
        <div role="alert" className="dz-card p-8 text-center text-sm text-gray-300">
          The directory could not be loaded. This is not an empty catalogue — nothing was read.
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <Table columns={dirCols} rows={state.items} rowKey={(s) => s.slug} label="directory" empty="No societies." mobileCard={dirCard} />
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <button
                onClick={() => onPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="dz-btn dz-btn-ghost disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-gray-400">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="dz-btn dz-btn-ghost disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

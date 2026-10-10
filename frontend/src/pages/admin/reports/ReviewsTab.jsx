import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { listReviewsForModeration, setReviewStatus } from '../../../services/reviewService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { classNames, fmtNum } from '../../../lib/format.js';
import Badge from '../../../components/ui/Badge.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, Chips, ClearFilters, PageNav, QueuePanel, RowCard, RowList, SearchBox,
} from '../../../components/admin/WorkQueue.jsx';

const PAGE_SIZE = 10;

/* Reviews are taken down via `PATCH /reviews/{id}/status`, not the report queue;
   `rejected` hides the text and drops it from the rating aggregate. */
export default function ReviewsTab() {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [pageState, setPageState] = useState({ page: 1, key: '' });
  const [bump, setBump] = useState(0);
  const countsFor = useRef(-1);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const filterKey = `${status}|${search}`;
  const pageNo = pageState.key === filterKey ? pageState.page : 1;

  // One page per read; the status totals ride along on first load and after a decision.
  useEffect(() => {
    let alive = true;
    listReviewsForModeration({ status, q: search, page: pageNo - 1, size: PAGE_SIZE, counts: countsFor.current !== bump })
      .then((r) => {
        if (!alive) return;
        if (r.counts) { countsFor.current = bump; setCounts(r.counts); }
        setData(r);
        setError('');
      })
      .catch(() => {
        if (!alive) return;
        setData({ items: [], total: 0 });
        setError('Reviews could not be loaded. This is not an empty queue — reload to try again.');
      });
    return () => { alive = false; };
  }, [status, search, pageNo, bump]);

  // Not optimistic: a row claiming a verdict the server refused would leave a review up that the
  // moderator believes is down.
  const decide = async (r, verdict) => {
    try {
      await setReviewStatus(r.id, verdict);
      setData((prev) => ({ ...prev, items: prev.items.map((x) => (x.id === r.id ? { ...x, status: verdict } : x)) }));
      setBump((b) => b + 1);
      toast(verdict === 'published' ? 'Approved' : 'Rejected');
    } catch {
      toast('Could not update. Please try again.', 'error');
    }
  };

  if (!data) return <Loading />;

  const rows = data.items;
  const paging = {
    page: pageNo,
    pageCount: Math.max(1, Math.ceil(data.total / PAGE_SIZE)),
    total: data.total,
    size: PAGE_SIZE,
    onPage: (p) => setPageState({ page: p, key: filterKey }),
  };
  const chip = (value, label) => ({ value, label: counts[value || 'all'] == null ? label : `${label} ${fmtNum(counts[value || 'all'])}` });
  const statusChips = [
    chip('', 'All'),
    chip('pending', 'Pending'),
    chip('published', 'Published'),
    chip('rejected', 'Rejected'),
  ];

  return (
    <QueuePanel
      active="reviews"
      note="User reviews on listings and societies. Approve publishes one; Reject hides the text and drops it from the rating."
      noteTestId="reviews-note"
      toolbar={(
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Author, item or text" label="Search reviews" />
          <Chips label="Status" options={statusChips} value={status} onChange={setStatus} />
          {status || q ? <ClearFilters onClick={() => { setStatus(''); setQ(''); }} /> : null}
          <div className="ml-auto"><PageNav {...paging} /></div>
        </>
      )}
      footer={paging.pageCount > 1 ? <PageNav {...paging} /> : null}
    >
      {error ? <div role="alert" className="border-b border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-sm text-rose-200">{error}</div> : null}
      <RowList isEmpty={!rows.length} empty={status || q ? 'No reviews match these filters.' : 'No reviews yet.'}>
        {rows.map((r) => (
          <RowCard
            key={r.id}
            id={r.id}
            title={r.user}
            badges={(
              <>
                <Badge status={r.status} />
                <span className={classNames(CHIP, CHIP_TONE.amber, 'gap-0.5')}><Star className="h-2.5 w-2.5" aria-hidden="true" />{r.rating || '—'}</span>
              </>
            )}
            meta={<><span>{r.target || '—'}</span>{r.at ? <><span className="text-gray-600" aria-hidden="true">·</span><span>{r.at}</span></> : null}</>}
            chips={r.text ? <p className="text-sm text-gray-300">{r.text}</p> : null}
            primary={(
              <>
                {r.status !== 'published' ? <button type="button" onClick={() => decide(r, 'published')} className={BTN.primary}>Approve</button> : null}
                {r.status !== 'rejected' ? <button type="button" onClick={() => decide(r, 'rejected')} className={BTN.danger}>Reject</button> : null}
              </>
            )}
          />
        ))}
      </RowList>
    </QueuePanel>
  );
}

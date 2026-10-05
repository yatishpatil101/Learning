import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { listReviewsForModeration, setReviewStatus } from '../../../services/reviewService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { classNames, fmtNum } from '../../../lib/format.js';
import Badge from '../../../components/ui/Badge.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, Chips, ClearFilters, PageNav, QueuePanel, RowCard, RowList, SearchBox, useClientPaging,
} from '../../../components/admin/WorkQueue.jsx';

/* Reviews are taken down through `PATCH /reviews/{id}/status`, not the report queue; `rejected` both hides the text and drops it from the rating aggregate. */
export default function ReviewsTab() {
  const { toast } = useToast();
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    listReviewsForModeration({ size: 100 })
      .then((r) => { if (alive) setReviews(r?.items || []); })
      .catch(() => {
        if (!alive) return;
        setReviews([]);
        setError('Reviews could not be loaded. This is not an empty queue — reload to try again.');
      });
    return () => { alive = false; };
  }, []);

  // Not optimistic: a row claiming a verdict the server refused would leave a review up that the
  // moderator believes is down.
  const decide = async (r, status) => {
    try {
      await setReviewStatus(r.id, status);
      setReviews((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
      toast(status === 'published' ? 'Approved' : 'Rejected');
    } catch {
      toast('Could not update. Please try again.', 'error');
    }
  };

  const list = reviews || [];
  const needle = q.trim().toLowerCase();
  const rows = list.filter((r) => (!status || r.status === status)
    && (!needle || [r.user, r.target, r.text].join(' ').toLowerCase().includes(needle)));
  const page = useClientPaging(rows, 10, `${status}|${q}`);

  if (!reviews) return <Loading />;

  const countOf = (s) => list.filter((r) => r.status === s).length;
  const statusChips = [
    { value: '', label: `All ${fmtNum(list.length)}` },
    { value: 'pending', label: `Pending ${fmtNum(countOf('pending'))}` },
    { value: 'published', label: `Published ${fmtNum(countOf('published'))}` },
    { value: 'rejected', label: `Rejected ${fmtNum(countOf('rejected'))}` },
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
          <div className="ml-auto"><PageNav {...page.paging} /></div>
        </>
      )}
      footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
    >
      {error ? <div role="alert" className="border-b border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-sm text-rose-200">{error}</div> : null}
      <RowList isEmpty={!rows.length} empty={status || q ? 'No reviews match these filters.' : 'No reviews yet.'}>
        {page.items.map((r) => (
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

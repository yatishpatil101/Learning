import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { listReviewsForModeration, setReviewStatus } from '../../../services/reviewService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Table from '../../../components/ui/Table.jsx';
import Loading from '../../../components/ui/Loading.jsx';

/* Reviews are taken down through `PATCH /reviews/{id}/status`, not the report queue; `rejected` both hides the text and drops it from the rating aggregate. */
export default function ReviewsTab() {
  const { toast } = useToast();
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState('');

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

  if (!reviews) return <Loading />;

  const actions = (r) => (
    <>
      {r.status !== 'published' ? <button onClick={() => decide(r, 'published')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal">Approve</button> : null}
      {r.status !== 'rejected' ? <button onClick={() => decide(r, 'rejected')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">Reject</button> : null}
    </>
  );

  const cols = [
    { key: 'author', header: 'Author', render: (r) => <div><div className="font-semibold">{r.user || r.author || 'User'}</div><div className="text-xs text-gray-400">{r.target || '—'}</div></div> },
    { key: 'rating', header: 'Rating', render: (r) => <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-400" />{r.rating || '—'}</span> },
    { key: 'text', header: 'Review', render: (r) => <span className="max-w-xs truncate text-sm">{r.text || r.body || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status || 'pending'} /> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (r) => <div className="flex gap-1">{actions(r)}</div> },
  ];

  const card = (r) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.user || r.author || 'User'}</div>
          <div className="truncate text-xs text-gray-400">{r.target || '—'}</div>
        </div>
        <div className="shrink-0 text-right">
          <span className="flex items-center justify-end gap-1 text-sm"><Star className="h-3.5 w-3.5 text-amber-400" />{r.rating || '—'}</span>
          <div className="mt-1"><Badge status={r.status || 'pending'} /></div>
        </div>
      </div>
      {(r.text || r.body) ? <div className="mt-2 text-sm text-gray-300">{r.text || r.body}</div> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">{actions(r)}</div>
    </div>
  );

  return (
    <div>
      {error ? <div role="alert" className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-200">{error}</div> : null}
      <p className="mb-3 text-xs text-gray-400">Approve or reject user reviews. ({reviews.length} total)</p>
      <Table columns={cols} rows={reviews} pageSize={10} label="reviews" empty="No reviews yet." mobileCard={card} />
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { approveIdentityReview, getIdentityReview, listIdentityReviews, rejectIdentityReview } from '../../services/identityReviewService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const FILTERS = ['pending', 'verified', 'rejected'];
const REASONS = ['blurry', 'cropped', 'mismatch', 'expired', 'not_holder', 'unsupported', 'other'];

const dateLabel = (value) => (value ? new Date(value).toLocaleString() : '—');

export default function OpsIdentityReview() {
  const [filter, setFilter] = useState('pending');
  const [queue, setQueue] = useState({ items: [], total: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [decisionError, setDecisionError] = useState('');
  // A decision is final and the server locks the case, so a second click loses: it comes back 409
  // on a case the reviewer just decided correctly, and reads as a failure. Refuse it here instead.
  const [deciding, setDeciding] = useState(false);
  const [approval, setApproval] = useState({ number: '', name: '', dob: '' });
  const [rejection, setRejection] = useState({ reason: 'blurry', note: '' });

  const loadQueue = useCallback(async (activeFilter = filter) => {
    setLoadingQueue(true);
    setError('');
    try {
      const next = await listIdentityReviews({ status: activeFilter, size: 50 });
      setQueue(next);
      const first = next.items[0]?.id || null;
      setSelectedId((current) => current && next.items.some((item) => item.id === current) ? current : first);
    } catch (nextError) {
      setError(nextError?.message || 'Could not load the KYC review queue.');
    } finally {
      setLoadingQueue(false);
    }
  }, [filter]);

  useEffect(() => { loadQueue(filter); }, [filter, loadQueue]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    setDecisionError('');
    getIdentityReview(selectedId)
      .then((next) => {
        if (!alive) return;
        setDetail(next);
        setApproval({
          number: '',
          name: next?.claims?.name || '',
          dob: next?.claims?.dob || '',
        });
        setRejection({ reason: next?.rejectionReason || 'blurry', note: next?.rejectionNote || '' });
      })
      .catch((nextError) => alive && setDecisionError(nextError?.message || 'Could not load this review.'))
      .finally(() => alive && setLoadingDetail(false));
    return () => { alive = false; };
  }, [selectedId]);

  async function refreshDetail() {
    if (!selectedId) return;
    setLoadingDetail(true);
    try {
      const next = await getIdentityReview(selectedId);
      setDetail(next);
    } catch (nextError) {
      setDecisionError(nextError?.message || 'Could not refresh image links.');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function decide(submit, failureMessage) {
    if (!detail || deciding) return;
    setDeciding(true);
    setDecisionError('');
    try {
      setDetail(await submit());
      await loadQueue(filter);
    } catch (nextError) {
      setDecisionError(nextError?.message || failureMessage);
    } finally {
      setDeciding(false);
    }
  }

  const approve = () => decide(() => approveIdentityReview(detail.id, approval), 'Could not approve this review.');
  const reject = () => decide(() => rejectIdentityReview(detail.id, rejection), 'Could not reject this review.');

  return (
    <div className="space-y-5">
      <PageHeader title="KYC Review" subtitle="Manual review for person identity verification. Approval confirms the badge; submission alone does not." />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${filter === value ? 'bg-brand-teal/20 text-brand-teal border border-brand-teal/30' : 'bg-white/5 text-gray-300 border border-white/10'}`}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
        <button type="button" onClick={() => loadQueue(filter)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300">Refresh queue</button>
      </div>
      {error && <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      <div className="grid gap-5 lg:grid-cols-[320px,minmax(0,1fr)]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between text-sm text-gray-400"><span>{loadingQueue ? 'Loading…' : `${queue.total} cases`}</span><span>{filter}</span></div>
          <div className="space-y-2">
            {queue.items.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-2xl border px-4 py-3 text-left ${selectedId === item.id ? 'border-brand-teal/40 bg-brand-teal/10' : 'border-white/10 bg-white/[0.02]'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{item.userName || 'Unknown user'}</p>
                    <p className="truncate text-xs text-gray-400">{item.userMobile || '—'} · {item.docType || '—'}</p>
                  </div>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-gray-300">{item.status}</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">Submitted {dateLabel(item.submittedAt)}</p>
              </button>
            ))}
            {!loadingQueue && queue.items.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-gray-500">No {filter} cases.</div>}
          </div>
        </section>
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          {!selectedId && <div className="grid min-h-[420px] place-items-center text-sm text-gray-500">Choose a case to review.</div>}
          {selectedId && loadingDetail && <div className="grid min-h-[420px] place-items-center text-sm text-gray-500">Loading review…</div>}
          {detail && !loadingDetail && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">{detail.userName || 'Unknown user'}</h2>
                  <p className="mt-1 text-sm text-gray-400">{detail.userMobile || '—'} · {detail.userRole || '—'} · {detail.docType || '—'}</p>
                  <p className="mt-1 text-xs text-gray-500">Submitted {dateLabel(detail.submittedAt)} · Decided {dateLabel(detail.decidedAt)}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={refreshDetail} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300">Refresh links</button>
                  <span className="rounded-full bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.08em] text-gray-300">{detail.status}</span>
                </div>
              </div>
              {decisionError && <div role="alert" data-testid="ops-identity-decision-error" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{decisionError}</div>}
              <div className="grid gap-3 md:grid-cols-3">
                <ImageCard title="Front" href={detail.images?.front} />
                <ImageCard title="Back" href={detail.images?.back} />
                <ImageCard title="Selfie" href={detail.images?.selfie} />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <p className="text-sm font-semibold text-white">OCR-derived fields</p>
                  <dl className="mt-4 space-y-3 text-sm">
                    <Field label="Number ending" value={detail.claims?.number || 'Not available'} />
                    <Field label="Name" value={detail.claims?.name || 'Not available'} />
                    <Field label="Date of birth" value={detail.claims?.dob || 'Not available'} />
                  </dl>
                  {detail.warnings?.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm font-semibold text-amber-300">Duplicate warnings</p>
                      {detail.warnings.map((warning) => (
                        <div key={`${warning.kind}:${warning.reviewId}`} className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{warning.kind.replaceAll('_', ' ')} · {warning.userName || warning.userId}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <p className="text-sm font-semibold text-white">Approve</p>
                    <p className="mt-1 text-xs text-gray-400">Type the full number from the image. Nothing here creates a new stored OCR field.</p>
                    <div className="mt-4 space-y-3">
                      <Input label="Document number" value={approval.number} onChange={(value) => setApproval((current) => ({ ...current, number: value }))} />
                      <Input label="Holder name" value={approval.name} onChange={(value) => setApproval((current) => ({ ...current, name: value }))} />
                      <Input label="Date of birth" type="date" value={approval.dob} onChange={(value) => setApproval((current) => ({ ...current, dob: value }))} />
                    </div>
                    <button type="button" data-testid="ops-identity-approve" onClick={approve} disabled={deciding} className="mt-4 rounded-xl bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{deciding ? 'Saving…' : 'Approve review'}</button>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <p className="text-sm font-semibold text-white">Reject</p>
                    <div className="mt-4 space-y-3">
                      <label className="block text-sm text-gray-300">Reason<select value={rejection.reason} onChange={(event) => setRejection((current) => ({ ...current, reason: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">{REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label>
                      <label className="block text-sm text-gray-300">Note<textarea value={rejection.note} onChange={(event) => setRejection((current) => ({ ...current, note: event.target.value }))} rows={4} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /></label>
                    </div>
                    <button type="button" data-testid="ops-identity-reject" onClick={reject} disabled={deciding} className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-50">{deciding ? 'Saving…' : 'Reject review'}</button>
                  </div>
                </div>
              </div>
              {detail.filesPurgedAt && <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-gray-400">Images purged {dateLabel(detail.filesPurgedAt)}.</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ImageCard({ title, href }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/10">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm text-white"><span>{title}</span>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-teal">Open</a> : <span className="text-xs text-gray-500">Unavailable</span>}</div>
      {href ? <img src={href} alt={`${title} identity evidence`} className="h-56 w-full object-cover" /> : <div className="grid h-56 place-items-center text-sm text-gray-500">No image available</div>}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-white">{value}</dd>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block text-sm text-gray-300">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /></label>
  );
}
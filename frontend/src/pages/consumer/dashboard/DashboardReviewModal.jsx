import { useCallback } from 'react';
import Icon from '../../../components/Icon.jsx';
import useModalDialog from '../../../hooks/useModalDialog.js';
import useScrollLock from '../../../hooks/useScrollLock.js';

/* Fully presentational: the case file arrives as `thread`, already fetched and marked read by
   `useDashboardData.openReview`. The title comes from the `listing` — the wire carries none, and a
   snapshot would go stale the first time the owner edited it. */
export default function DashboardReviewModal({ reviewProp, setReviewProp, thread, listing, reviewInput, setReviewInput, sendReview, REVIEW_STATUS }) {
  /* Above the early return and passed a boolean: this modal hides itself rather than being
     mount-gated, and `reviewProp`'s identity would otherwise re-take the lock on each change. */
  useScrollLock(Boolean(reviewProp));
  const close = useCallback(() => setReviewProp(null), [setReviewProp]);
  const panelRef = useModalDialog(Boolean(reviewProp), close);
  if (!reviewProp) return null;
  // `thread` is null between opening and the fetch landing, and stays null when the listing has no
  // case file at all.
  const rs = REVIEW_STATUS[thread?.status] || REVIEW_STATUS.in_review;
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md" onClick={() => setReviewProp(null)}>
      {/* Named by its own heading rather than a literal: the heading is the listing's title, so a
          fixed string would announce a name that appears nowhere on screen. Singleton per
          dashboard, hence a static id. */}
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dash-review-title" className="dz-modal-panel border border-white/10 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] flex flex-col shadow-2xl outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 id="dash-review-title" className="text-white font-bold text-base truncate">{listing?.title || 'Verification'}</h3>
            <span className={'mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border font-semibold ' + rs.cls}><Icon name={rs.icon} className="w-3 h-3" /> {rs.label}</span>
          </div>
          <button onClick={() => setReviewProp(null)} className="text-gray-400 hover:text-white flex-shrink-0"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        {!thread ? (
          <p className="flex-1 grid place-items-center text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            {thread.checklist.length ? (
              <div className="mb-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Verification checklist</p>
                <div className="space-y-1.5">
                  {thread.checklist.map((c) => (
                    <div key={c.item} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-gray-300 truncate">{c.item}</span>
                      {/* Two states, not three: the server stores one boolean per line, so
                          "rejected" and "not looked at yet" were never distinguishable. */}
                      <span className={c.pass ? 'text-emerald-300' : 'text-amber-300'}>
                        {c.pass ? 'checked' : 'pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {thread.messages.map((m) => (
                <div key={m.id} className={'flex ' + (m.from === 'owner' ? 'justify-end' : 'justify-start')}>
                  <div className={'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ' + (m.from === 'owner' ? 'bg-brand-teal/20 text-teal-100' : 'bg-white/8 text-gray-200')}>
                    {m.body}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-3 flex items-center gap-2">
          <input value={reviewInput} onChange={(e) => setReviewInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendReview(); }} placeholder="Reply to Draazy…" className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-teal-400/50" />
          <button onClick={sendReview} disabled={!thread} className="btn-teal px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"><Icon name="send" className="w-4 h-4" /> Send</button>
        </div>
      </div>
    </div>
  );
}

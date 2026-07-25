import Icon from '../../../components/Icon.jsx';
import { getPropReview } from '../../../lib/store.js';

/* Owner ↔ PuneNest verification thread modal. Presentational — reads the live
   review record for the open property and relays replies back to the container. */
export default function DashboardReviewModal({ reviewProp, setReviewProp, reviewInput, setReviewInput, sendReview, REVIEW_STATUS }) {
  if (!reviewProp) return null;
  const t = getPropReview(reviewProp);
  if (!t) return null;
  const rs = REVIEW_STATUS[t.status] || REVIEW_STATUS.in_review;
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md" onClick={() => setReviewProp(null)}>
      <div className="pn-modal-panel border border-white/10 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-white font-bold text-base truncate">{t.title || 'Verification'}</h3>
            <span className={'mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border font-semibold ' + rs.cls}><Icon name={rs.icon} className="w-3 h-3" /> {rs.label}</span>
          </div>
          <button onClick={() => setReviewProp(null)} className="text-gray-400 hover:text-white flex-shrink-0"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        {t.docs && t.docs.length ? (
          <div className="mb-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Documents</p>
            <div className="space-y-1.5">
              {t.docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-300 truncate">{d.name}</span>
                  <span className={d.status === 'verified' ? 'text-emerald-300' : d.status === 'rejected' ? 'text-rose-300' : 'text-amber-300'}>{d.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {(t.messages || []).map((m) => (
            <div key={m.id} className={'flex ' + (m.from === 'owner' ? 'justify-end' : 'justify-start')}>
              <div className={'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ' + (m.from === 'owner' ? 'bg-brand-teal/20 text-teal-100' : 'bg-white/8 text-gray-200')}>
                {m.text}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input value={reviewInput} onChange={(e) => setReviewInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendReview(); }} placeholder="Reply to PuneNest…" className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-teal-400/50" />
          <button onClick={sendReview} className="btn-teal px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"><Icon name="send" className="w-4 h-4" /> Send</button>
        </div>
      </div>
    </div>
  );
}

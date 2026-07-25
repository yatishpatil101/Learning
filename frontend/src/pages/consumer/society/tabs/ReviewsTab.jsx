import Icon from '../../../../components/Icon.jsx';
import { Stars } from '../../property/Stars.jsx';

export default function ReviewsTab({ ctx }) {
  const {
    showEstimate, rating, overall, bars, reviews, openReport,
    qText, setQText, submitQuestion, inp, qa,
    answerFor, aText, setAText, submitAnswer, setAnswerFor,
  } = ctx;
  return (
            <>
            {/* Resident ratings breakdown + reviews */}
            <section className="reveal">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold flex items-center gap-2"><Icon name="star" className="w-5 h-5 text-amber-400" /> Resident ratings</h2>
                {(showEstimate || rating.count) ? <span className="text-sm"><span className="text-white font-bold">{overall}</span><span className="text-gray-500">/5</span></span> : null}
              </div>
              {(showEstimate || rating.count) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mb-4">
                  {bars.map((b) => (
                    <div key={b.label} className="rd-cell">
                      <div className="flex items-center justify-between mb-1.5"><span className="text-xs font-medium text-slate-300">{b.label}</span><span className="text-xs font-bold text-white">{b.value}</span></div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-brand-teal-2" style={{ width: `${(b.value / 5) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : null}
              {reviews.length ? (
                <div className="space-y-3">
                  {reviews.slice(0, 5).map((r) => (
                    <div key={r.id} className="glass rounded-xl p-4"><div className="flex items-center justify-between mb-1"><span className="font-semibold text-sm flex items-center gap-1.5">{r.user}{r.resident ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300"><Icon name="badge-check" className="w-3 h-3" /> Resident</span> : null}</span><span className="flex items-center gap-2"><Stars value={r.rating} size={14} /><button onClick={() => openReport({ targetType: 'review', targetId: r.id, snapshot: r.text || `${r.rating}★ by ${r.user}` })} aria-label="Report review" className="text-gray-500 hover:text-amber-300"><Icon name="flag" className="w-3.5 h-3.5" /></button></span></div>{r.text ? <p className="text-gray-400 text-sm">{r.text}</p> : null}</div>
                  ))}
                </div>
              ) : <p className="text-gray-500 text-sm">No resident reviews yet — tap <b>Review</b> to be the first.</p>}
            </section>

            {/* Q&A */}
            <section className="reveal">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Icon name="message-circle" className="w-5 h-5 text-teal-400" /> Ask residents</h2>
              <div className="flex gap-2 mb-4">
                <input value={qText} onChange={(e) => setQText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitQuestion()} placeholder="e.g. Is water supply reliable in summer?" className={inp} />
                <button onClick={submitQuestion} className="btn-teal flex-shrink-0"><Icon name="send" className="w-4 h-4 mr-1.5" /> Ask</button>
              </div>
              {qa.length ? (
                <div className="space-y-3">
                  {qa.map((q) => (
                    <div key={q.id} className="glass rounded-xl p-4">
                      <p className="text-sm font-semibold text-white flex items-start gap-2"><Icon name="help-circle" className="w-4 h-4 text-brand-teal-3 mt-0.5 flex-shrink-0" /> <span className="flex-1">{q.text}</span><button onClick={() => openReport({ targetType: 'question', targetId: q.id, snapshot: q.text })} aria-label="Report question" className="text-gray-500 hover:text-amber-300 flex-shrink-0"><Icon name="flag" className="w-3.5 h-3.5" /></button></p>
                      <p className="text-[11px] text-slate-500 ml-6 mb-2 flex items-center gap-1.5">asked by {q.user}{q.resident ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300"><Icon name="badge-check" className="w-3 h-3" /> Resident</span> : null}</p>
                      {(q.answers || []).map((a) => (
                        <p key={a.id} className="text-sm ml-6 mb-1.5 flex items-start gap-2"><Icon name="arrow-right" className="w-3.5 h-3.5 text-slate-500 mt-1 flex-shrink-0" /> <span className="text-slate-400 flex-1">{a.text} <span className="text-[11px] text-slate-600">— {a.user}{a.resident ? <span className="inline-flex items-center gap-0.5 text-violet-400 font-semibold"> · <Icon name="badge-check" className="w-3 h-3" /> Resident</span> : null}</span></span><button onClick={() => openReport({ targetType: 'answer', targetId: a.id, parentId: q.id, snapshot: a.text })} aria-label="Report answer" className="text-slate-600 hover:text-amber-300 flex-shrink-0"><Icon name="flag" className="w-3 h-3" /></button></p>
                      ))}
                      {answerFor === q.id ? (
                        <div className="flex gap-2 mt-2 ml-6"><input value={aText} onChange={(e) => setAText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitAnswer(q.id)} placeholder="Write an answer…" className={inp} autoFocus /><button onClick={() => submitAnswer(q.id)} className="btn-teal">Post</button></div>
                      ) : <button onClick={() => { setAnswerFor(q.id); setAText(''); }} className="text-xs font-medium text-brand-teal-3 hover:underline ml-6 mt-1">Answer</button>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-gray-500 text-sm">No questions yet — ask the community anything about this society.</p>}
            </section>

            </>
  );
}

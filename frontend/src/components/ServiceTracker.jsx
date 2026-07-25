import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import HScroll from './ui/HScroll.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  list, listForParty, STEPS, stepStates, statusMeta, isActive, progressPct,
  decideDraft, addMessage, markRead, makeSampleRequest,
} from '../lib/serviceFlow.js';

function ProgressBar({ status }) {
  const pct = progressPct(status);
  if (pct == null) return null;
  const done = pct >= 100;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-gray-400 font-medium">Progress</span>
        <span className={'text-[11px] font-semibold ' + (done ? 'text-emerald-300' : 'text-teal-300')}>{pct}% complete</span>
      </div>
      <div className="h-2 rounded-full bg-white/15 overflow-hidden ring-1 ring-inset ring-white/5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Request progress">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: (pct > 0 ? Math.max(pct, 4) : 0) + '%', background: done ? 'linear-gradient(to right,#10b981,#34d399)' : 'var(--brand-gradient)' }} />
      </div>
    </div>
  );
}

function Stepper({ status }) {
  const states = stepStates(status);
  return (
    <HScroll wrapClassName="mb-4" className="flex items-center gap-1 pb-1" fadeColor="#211f2b">
      {STEPS.map((lab, i) => {
        const st = states[i];
        const dot = st === 'done' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          : st === 'active' ? 'bg-teal-500/20 text-teal-300 border-teal-500/30'
          : 'bg-white/5 text-gray-500 border-white/10';
        return (
          <div key={lab} className="flex items-center gap-1 flex-shrink-0">
            <div className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ' + dot}>
              <Icon name={st === 'done' ? 'check' : st === 'active' ? 'loader' : 'circle'} className="w-3 h-3" /> {lab}
            </div>
            {i < STEPS.length - 1 ? <div className={'w-4 h-px ' + (st === 'done' ? 'bg-emerald-500/40' : 'bg-white/10')} /> : null}
          </div>
        );
      })}
    </HScroll>
  );
}

export default function ServiceTracker({ typeFilter, title = 'Your requests', sampleName }) {
  const { user, isIn } = useAuth();
  const { toast } = useToast();
  const mobile = user?.mobile || '';
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');
  const [changeReq, setChangeReq] = useState(null); // request awaiting a "request changes" note
  const [changeNote, setChangeNote] = useState('');
  const refresh = () => setTick((t) => t + 1);

  // Lock scroll + close on Escape while the "Request changes" modal is open.
  useEffect(() => {
    if (!changeReq) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && setChangeReq(null);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [changeReq]);

  const requests = useMemo(() => {
    if (!isIn || !mobile) return [];
    const own = list(mobile).filter((r) => !typeFilter || r.type === typeFilter);
    const party = listForParty(mobile).filter((r) => (!typeFilter || r.type === typeFilter) && !own.some((o) => o.id === r.id));
    return [...own, ...party].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, isIn, typeFilter, tick]);

  const openDraft = (r) => { if (r.draft?.dataUrl) window.open(r.draft.dataUrl, '_blank', 'noopener'); };
  const openFinal = (r) => { if (r.finalDoc?.dataUrl) window.open(r.finalDoc.dataUrl, '_blank', 'noopener'); };
  const approve = (r) => { decideDraft(r._mobile || mobile, r.id, 'accepted'); refresh(); toast('Draft approved — we\'ll proceed with registration.', 'success'); };
  const requestChanges = (r) => { setChangeNote(''); setChangeReq(r); };
  const submitChanges = () => {
    const note = changeNote.trim();
    if (!note || !changeReq) return;
    decideDraft(changeReq._mobile || mobile, changeReq.id, 'changes', note);
    setChangeReq(null);
    refresh();
    toast('Change request sent to our team.', 'success');
  };
  const send = (r) => {
    if (!msg.trim()) return;
    addMessage(r._mobile || mobile, r.id, 'user', msg);
    setMsg('');
    refresh();
  };
  const openThread = (r) => {
    markRead(r._mobile || mobile, r.id, 'user');
    setOpenId(openId === r.id ? null : r.id);
    refresh();
  };
  const loadSample = () => { makeSampleRequest(mobile, sampleName || user?.name); refresh(); toast('Sample request loaded — review the draft below.', 'success'); };

  if (!isIn) return null;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pt">
      <div className="glass-card rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h2 className="text-white font-bold text-lg flex items-center gap-2"><Icon name="list-checks" className="w-5 h-5 text-teal-400" /> {title}</h2>
          {sampleName !== undefined ? (
            <button type="button" onClick={loadSample} className="btn-outline px-4 py-2 rounded-xl text-teal-400 text-sm font-semibold inline-flex items-center gap-2"><Icon name="sparkles" className="w-4 h-4" /> Preview with a sample draft</button>
          ) : null}
        </div>
        <p className="text-gray-400 text-sm mb-4">Track progress, review the draft we prepare, and approve it so we can register it with the government.</p>

        {requests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-3"><Icon name="file-clock" className="w-6 h-6 text-gray-500" /></div>
            <p className="text-white text-sm font-semibold">No active request yet</p>
            <p className="text-gray-500 text-xs mt-1 max-w-md mx-auto">Submit the form below to start one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((r) => {
              const m = statusMeta(r.status);
              const unreadStaff = (r.messages || []).filter((x) => x.from === 'staff' && !x.read).length;
              return (
                <div key={r.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm">{r.service}</p>
                      <p className="text-gray-500 text-xs truncate">{r.details?.property || r.details?.from || 'Request'} · {r.id.slice(0, 10)}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: m.bg, color: m.color }}><Icon name={m.icon} className="w-3 h-3" /> {m.label}</span>
                  </div>

                  <ProgressBar status={r.status} />
                  <Stepper status={r.status} />

                  {(() => {
                  // Mobile: lay the actions out as an even 2-col grid so long labels
                  // don't wrap into a ragged staircase; desktop keeps them inline.
                  // When Messages is the only action, let it span the full width.
                  const soloMsg = r.status !== 'draft_shared' && !(r.status === 'completed' && r.finalDoc);
                  return (
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    {r.status === 'draft_shared' ? (
                      <>
                        <button onClick={() => openDraft(r)} className="btn-outline w-full sm:w-auto justify-center px-3 py-2 rounded-lg text-gray-200 text-xs font-semibold inline-flex items-center gap-1.5"><Icon name="file-text" className="w-3.5 h-3.5" /> View draft{r.draft?.version ? ' v' + r.draft.version : ''}</button>
                        <button onClick={() => approve(r)} className="btn-teal w-full sm:w-auto justify-center px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"><Icon name="check" className="w-3.5 h-3.5" /> Approve</button>
                        <button onClick={() => requestChanges(r)} className="btn-outline w-full sm:w-auto justify-center px-3 py-2 rounded-lg text-gray-200 text-xs font-semibold inline-flex items-center gap-1.5"><Icon name="rotate-ccw" className="w-3.5 h-3.5" /> Request changes</button>
                      </>
                    ) : null}
                    {r.status === 'completed' && r.finalDoc ? (
                      <button onClick={() => openFinal(r)} className="btn-teal w-full sm:w-auto justify-center px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"><Icon name="download" className="w-3.5 h-3.5" /> Download registered copy</button>
                    ) : null}
                    <button onClick={() => openThread(r)} className={'btn-outline w-full sm:w-auto justify-center relative px-3 py-2 rounded-lg text-gray-200 text-xs font-semibold inline-flex items-center gap-1.5 ' + (soloMsg ? 'col-span-2 sm:col-span-1' : '')}>
                      <Icon name="message-square" className="w-3.5 h-3.5" /> Messages
                      {unreadStaff ? <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center font-bold">{unreadStaff}</span> : null}
                    </button>
                  </div>
                  );
                  })()}

                  {openId === r.id ? (
                    <div className="mt-3 rounded-xl border border-white/8 bg-black/20 p-3">
                      <div className="space-y-2 max-h-56 overflow-y-auto mb-2">
                        {(r.messages || []).map((x, i) => (
                          <div key={x.id || i} className={'flex ' + (x.from === 'user' ? 'justify-end' : 'justify-start')}>
                            <div className={'max-w-[80%] rounded-2xl px-3 py-1.5 text-xs ' + (x.from === 'user' ? 'bg-brand-teal/20 text-teal-100' : 'bg-white/8 text-gray-200')}>{x.text}</div>
                          </div>
                        ))}
                      </div>
                      {isActive(r.status) ? (
                        <div className="flex items-center gap-2">
                          <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(r); }} placeholder="Message our team…" className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-teal-400/50" />
                          <button onClick={() => send(r)} className="btn-teal px-3 py-2 rounded-lg text-xs font-semibold">Send</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {changeReq ? (
        <div className="pn-modal-backdrop" role="dialog" aria-modal="true" aria-label="Request changes" onClick={(e) => { if (e.target === e.currentTarget) setChangeReq(null); }}>
          <div className="pn-modal">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Request changes</h3>
                <p className="text-xs text-slate-400 mt-0.5">Tell our team what to revise on your {changeReq.service} draft — we'll share an updated version for your approval.</p>
              </div>
              <button onClick={() => setChangeReq(null)} className="pn-modal-x" aria-label="Close"><Icon name="x" className="w-5 h-5" /></button>
            </div>
            <label className="block text-sm font-medium text-slate-300 mb-2">What would you like changed?</label>
            <textarea autoFocus value={changeNote} onChange={(e) => setChangeNote(e.target.value)} rows={4} className="w-full px-4 py-3 rounded-xl text-white text-sm resize-none border border-white/10 bg-white/[0.03] focus:border-brand-teal-2 outline-none mb-4" placeholder="e.g. Please correct the monthly rent to ₹32,000 and set the lock-in to 6 months." />
            <div className="flex gap-2">
              <button type="button" onClick={() => setChangeReq(null)} className="btn-outline flex-1 py-2.5 rounded-xl text-gray-200 text-sm font-semibold">Cancel</button>
              <button type="button" onClick={submitChanges} disabled={!changeNote.trim()} className="btn-teal flex-1 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"><Icon name="rotate-ccw" className="w-4 h-4" /> Send request</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

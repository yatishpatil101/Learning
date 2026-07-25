import { Check, Save, X } from 'lucide-react';
import Modal from '../../../../components/ui/Modal.jsx';
import DocPill from './DocPill.jsx';

export default function DocViewerModal({ dv, dvDoc, review, dvNote, setDvNote, setDv, dvSetStatus, dvSaveNote }) {
  return (
    <Modal open={!!dv && !!dvDoc} onClose={() => setDv(null)} title={dvDoc?.name || 'Document'} size="lg">
      {dvDoc && review ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-gray-400">{review.title} {'\u00B7'} {review.owner}</div>
            <div className="flex items-center gap-2">
              <DocPill status={dvDoc.status} />
              <button onClick={() => dvSetStatus('verified')} className="pn-btn pn-btn-success pn-btn-sm"><Check className="h-4 w-4" /> Verify</button>
              <button onClick={() => dvSetStatus('rejected')} className="pn-btn pn-btn-danger pn-btn-sm"><X className="h-4 w-4" /> Reject</button>
            </div>
          </div>
          <div className="relative min-h-[320px] rounded-lg bg-slate-50 px-8 py-7 text-slate-900 shadow-2xl">
            <div className="absolute right-5 top-4 text-[10px] font-bold uppercase tracking-widest text-slate-300">PuneNest {'\u00B7'} Verification preview</div>
            <h4 className="text-lg font-extrabold text-slate-900">{dvDoc.name}</h4>
            <div className="mb-4 border-b-2 border-slate-900 pb-3 text-xs text-slate-500">Submitted document {'\u00B7'} {review.owner}</div>
            {[['Property', review.title], ['Listing ID', review.id], ['Locality', review.locality], ['Owner', review.owner], ['Owner contact', review.ownerMobile || '\u2014'], ['Submitted', review.createdAt]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-dashed border-slate-300 py-2 text-sm">
                <span className="font-semibold text-slate-500">{k}</span>
                <span className="font-bold text-slate-900">{v}</span>
              </div>
            ))}
            {dvDoc.note ? (
              <div className="flex justify-between gap-3 border-b border-dashed border-slate-300 py-2 text-sm">
                <span className="font-semibold text-slate-500">Reviewer note</span>
                <span className="font-bold text-slate-900">{dvDoc.note}</span>
              </div>
            ) : null}
            {dvDoc.status === 'verified' ? (
              <div className="mt-5 inline-block -rotate-3 rounded-lg border-2 border-teal-600 px-3.5 py-1.5 text-sm font-extrabold tracking-wide text-teal-600">{'\u2713'} Verified</div>
            ) : dvDoc.status === 'rejected' ? (
              <div className="mt-5 inline-block -rotate-3 rounded-lg border-2 border-rose-600 px-3.5 py-1.5 text-sm font-extrabold tracking-wide text-rose-600">{'\u2717'} Rejected</div>
            ) : null}
            <div className="mt-5 text-xs italic text-slate-400">Simulated preview for the prototype. In production the owner's uploaded file (PDF or image) renders here.</div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-300">Reviewer note for the owner</label>
            <div className="flex items-stretch gap-2">
              <textarea value={dvNote} onChange={(e) => setDvNote(e.target.value)} rows={2} placeholder={'Add a note about this document\u2026'} className="pn-input flex-1 resize-none" />
              <button onClick={dvSaveNote} title="Save note" className="pn-btn pn-btn-primary"><Save className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
